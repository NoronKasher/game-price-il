import type { api as LiveApi } from './api';
import type {
  AppNotification,
  GameHit,
  GameMeta,
  HistoryPoint,
  KeysResponse,
  Offer,
  Platform,
  SearchResponse,
  SettingsResponse,
  SourceRef,
  SourceStatus,
  TickerDeal,
  TrackDetail,
  WishlistItem,
} from './types';

/**
 * The API the public demo talks to instead of a server.
 *
 * GitHub Pages serves files — there is no Node process there, so no SQLite, no
 * background capture, and no fan-out to fifteen stores. This module answers the
 * exact same calls out of a snapshot recorded from a REAL run of the tool
 * (web/demo/capture.mjs), so the demo shows prices the tool genuinely found on
 * one day rather than numbers someone made up.
 *
 * The build swaps this in for `./api` by alias (web/vite.config.ts, demo mode
 * only), which is why it is typed against the live client: if the two ever
 * drift, this file stops compiling.
 *
 * Writes are honoured in memory for the length of the visit — tracking a game
 * really does add it to the list, and it really is gone on reload. Pretending a
 * write succeeded while ignoring it would be worse than either.
 */

interface OffersPayload {
  offers: Offer[];
  partial?: boolean;
  sources?: SourceStatus[];
}

interface TrackStatus {
  tracked: boolean;
  id?: number;
  history: HistoryPoint[];
}

interface Snapshot {
  capturedAt: string;
  searches: Record<string, SearchResponse>;
  /** Add-on searches, recorded only for titles that have a catalogue worth showing. */
  searchesDlc?: Record<string, SearchResponse>;
  offers: Record<string, OffersPayload>;
  meta: Record<string, GameMeta | null>;
  suggest: Record<string, string[]>;
  trackStatus: Record<string, TrackStatus>;
  trackDetail: Record<string, TrackDetail>;
  wishlist: WishlistItem[];
  settings: SettingsResponse;
  keys: KeysResponse;
  notifications: AppNotification[];
  health: { report: import('./types').HealthReport | null; due: boolean };
  psnHash: import('./types').PsnHashStatus | null;
  ticker: TickerDeal[];
}

/** BASE_URL so this resolves under the repo subpath a project Pages site uses. */
const SNAPSHOT_URL = `${import.meta.env.BASE_URL}snapshot.json`;

let loading: Promise<Snapshot> | null = null;
function snap(): Promise<Snapshot> {
  loading ??= fetch(SNAPSHOT_URL).then((r) => {
    if (!r.ok) throw new Error(`snapshot ${r.status}`);
    return r.json() as Promise<Snapshot>;
  });
  return loading;
}

/** Everything a visitor can change, seeded from the snapshot and lost on reload. */
interface Session {
  wishlist: WishlistItem[];
  notifications: AppNotification[];
  settings: SettingsResponse;
  keys: KeysResponse;
  nextId: number;
}

let sessionPromise: Promise<Session> | null = null;
function session(): Promise<Session> {
  sessionPromise ??= snap().then((s) => ({
    wishlist: structuredClone(s.wishlist),
    notifications: structuredClone(s.notifications),
    settings: structuredClone(s.settings),
    keys: structuredClone(s.keys),
    nextId: s.wishlist.reduce((max, w) => Math.max(max, w.id), 0) + 1,
  }));
  return sessionPromise;
}

/** The key DepartureBoard derives from its refs — capture.mjs writes the same. */
const refsKey = (refs: SourceRef[]) => refs.map((r) => `${r.sourceId}:${r.sourceGameId}`).join('|');

/** Accent- and punctuation-insensitive, so "pokemon" finds "Pokémon". */
function norm(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Which (game, platform) pairs this snapshot can actually put a price on.
 *
 * A recorded search answers with everything the stores returned — a search for
 * Elden Ring comes back with forty-five distinct games — but the capture only
 * has the budget to record price boards for the first few of them. The rest
 * looked like results and opened onto an empty board, and there were six of
 * those for every one that worked. A comparison tool whose cards mostly lead
 * nowhere teaches the visitor that the tool does not work.
 *
 * So the demo shows only what it can price. This is a demo-only rule: against a
 * live server (and against the extension) every card is priced on demand, which
 * is why it lives here and not in the UI.
 */
// A separator no title can contain. Written as an escape rather than a
// literal NUL: the literal made every tool treat this file as binary, so
// grep and diff quietly skipped it.
const PAIR = '\u0000';
const pairKey = (groupKey: string, platform: string) => `${groupKey}${PAIR}${platform}`;

let pricedCache: Set<string> | null = null;
function priced(s: Snapshot): Set<string> {
  if (pricedCache) return pricedCache;
  const out = new Set<string>();
  const responses = [...Object.values(s.searches), ...Object.values(s.searchesDlc ?? {})];
  for (const response of responses) {
    // Rebuild the refs the board will send for each pair — the same grouping
    // DepartureBoard does — and look for the recording under that exact key.
    const byPair = new Map<string, SourceRef[]>();
    for (const hit of response.games) {
      const key = pairKey(hit.groupKey, hit.platform);
      const list = byPair.get(key) ?? [];
      list.push({ sourceId: hit.sourceId, sourceGameId: hit.sourceGameId });
      byPair.set(key, list);
    }
    for (const [key, refs] of byPair) {
      const platform = key.slice(key.indexOf(PAIR) + 1);
      const payload = s.offers[`${platform}|${refsKey(refs)}`];
      // A board recorded as empty is as dead an end as one never recorded.
      if (payload && payload.offers.length > 0) out.add(key);
    }
  }
  pricedCache = out;
  return out;
}

/** Drop the cards this snapshot cannot price, and anything left dangling by that. */
function onlyPriced(s: Snapshot, response: SearchResponse): SearchResponse {
  const ok = priced(s);
  const games = response.games.filter((h) => ok.has(pairKey(h.groupKey, h.platform)));
  if (games.length === response.games.length) return response;
  const survivors = new Set(games.map((h) => h.groupKey));
  return {
    ...response,
    games,
    query: { ...response.query, platforms: [...new Set(games.map((h) => h.platform))] as Platform[] },
    // The exact-match key auto-opens a board. Pointing it at a game that was
    // just filtered out would open an empty one.
    queryKey: response.queryKey && survivors.has(response.queryKey) ? response.queryKey : undefined,
  };
}

/** Every priced game hit the snapshot knows about, across all recorded searches. */
function allHits(s: Snapshot): GameHit[] {
  const ok = priced(s);
  const seen = new Set<string>();
  const out: GameHit[] = [];
  for (const response of Object.values(s.searches)) {
    for (const hit of response.games) {
      const k = `${hit.sourceId}:${hit.sourceGameId}:${hit.platform}`;
      if (seen.has(k) || !ok.has(pairKey(hit.groupKey, hit.platform))) continue;
      seen.add(k);
      out.push(hit);
    }
  }
  return out;
}

/**
 * A query the capture never ran still gets a real answer when it names a game
 * we hold — someone typing "elden" should not hit a dead end just because the
 * recorded query was "Elden Ring".
 */
function searchFallback(s: Snapshot, q: string): SearchResponse {
  const needle = norm(q);
  const games = needle ? allHits(s).filter((h) => norm(h.title).includes(needle)) : [];
  const platforms = [...new Set(games.map((h) => h.platform))] as Platform[];
  // Reproduce the server's exact-match signal so the auto-open behaves the same:
  // one group whose title IS what was typed means the visitor already chose.
  const exact = [...new Set(games.filter((h) => norm(h.title) === needle).map((h) => h.groupKey))];
  return {
    query: { title: q, platforms },
    queryKey: exact.length === 1 ? exact[0] : undefined,
    games,
    sources: [],
  };
}


/**
 * If the VGPT extension is installed, the demo stops being a recording.
 *
 * A page on GitHub Pages cannot fetch the stores itself — CheapShark opts in
 * with CORS headers, but Steam, VGS and Ivory do not, so the browser refuses.
 * An extension has host permissions and no such limit, so when its content
 * script announces itself we route price lookups through it and show today's
 * prices instead of the captured ones. Everything else — the tracked list, the
 * settings — stays on the snapshot, because a web page has no business reaching
 * into someone's extension storage.
 */
export function extensionVersion(): string | null {
  return document.documentElement.dataset.vgptExtension ?? null;
}

let bridgeId = 0;
const bridgeWaiting = new Map<number, (msg: { result?: unknown; error?: string }) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const d = event.data as { __vgpt?: string; id?: number; result?: unknown; error?: string } | null;
    if (!d || d.__vgpt !== 'res' || typeof d.id !== 'number') return;
    const waiting = bridgeWaiting.get(d.id);
    if (!waiting) return;
    bridgeWaiting.delete(d.id);
    waiting(d);
  });
}

/** Ask the extension. Rejects on timeout so a live call can fall back cleanly. */
function viaExtension<T>(method: string, args: unknown[], timeoutMs = 90_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++bridgeId;
    const timer = setTimeout(() => {
      bridgeWaiting.delete(id);
      reject(new Error('extension timed out'));
    }, timeoutMs);
    bridgeWaiting.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result as T);
    });
    window.postMessage({ __vgpt: 'req', id, method, args }, window.location.origin);
  });
}

/**
 * Live when the extension is there, recorded when it is not.
 *
 * The fallback is deliberate: an extension that is installed but wedged should
 * cost the visitor a slower answer, never a blank page.
 */
async function live<T>(method: string, args: unknown[], recorded: () => T | Promise<T>): Promise<T> {
  if (!extensionVersion()) return recorded();
  try {
    return await viaExtension<T>(method, args);
  } catch {
    return recorded();
  }
}

export const api: typeof LiveApi = {
  async search(q: string, includeDlc = false): Promise<SearchResponse> {
    return live('search', [q, includeDlc], async () => {
      const s = await snap();
      const key = q.trim().toLowerCase();
      // Add-on searches are recorded separately, and only for titles with a
      // catalogue worth showing — so the DLC panel has real data to open, and a
      // title without one falls back to the games-only answer rather than
      // pretending nothing was found.
      if (includeDlc && s.searchesDlc?.[key]) return onlyPriced(s, s.searchesDlc[key]);
      const recorded = s.searches[key];
      return recorded ? onlyPriced(s, recorded) : searchFallback(s, q);
    });
  },

  /**
   * A recording has nothing to stream: every answer is already here.
   *
   * So the bar completes in one step rather than being animated through fake
   * stages. A progress bar that invents intermediate states to look busy is
   * lying about where the time went — and in the demo, there is no time.
   */
  async searchStream(
    q: string,
    includeDlc: boolean,
    onProgress: (p: import('./types').SearchProgress) => void
  ): Promise<SearchResponse> {
    const result = await this.search(q, includeDlc);
    const sources = result.sources ?? [];
    const total = Math.max(sources.length, 1);
    onProgress({
      total,
      done: total,
      status: sources[sources.length - 1] ?? { id: 'snapshot', name: 'snapshot', ok: true, count: result.games.length },
      games: result.games,
    });
    return result;
  },

  async offers(refs: SourceRef[], platform: string) {
    return live('offers', [refs, platform], async () => {
      const s = await snap();
      const payload = s.offers[`${platform}|${refsKey(refs)}`];
      return { offers: payload?.offers ?? [], partial: payload?.partial, sources: payload?.sources ?? [] };
    });
  },

  /** Recorded prices are already here; the bar completes in one step. */
  async offersStream(
    refs: SourceRef[],
    platform: string,
    onProgress: (p: import('./types').OffersProgress) => void
  ) {
    const result = await this.offers(refs, platform);
    const sources = result.sources ?? [];
    const total = Math.max(sources.length, 1);
    onProgress({
      total,
      done: total,
      status: sources[sources.length - 1] ?? { id: 'snapshot', name: 'snapshot', ok: true, count: result.offers.length },
      offers: result.offers,
    });
    return result;
  },

  async meta(refs: SourceRef[]) {
    return live('meta', [refs], async () => {
      const s = await snap();
      return { meta: s.meta[refsKey(refs)] ?? null };
    });
  },

  async suggest(q: string) {
    const s = await snap();
    const key = q.trim().toLowerCase();
    const recorded = s.suggest[key];
    if (recorded) return { suggestions: recorded };
    const needle = norm(q);
    if (needle.length < 3) return { suggestions: [] };
    const titles = new Set<string>();
    for (const h of allHits(s)) if (norm(h.title).includes(needle)) titles.add(h.title);
    return { suggestions: [...titles].slice(0, 8) };
  },

  async ticker() {
    return { deals: (await snap()).ticker };
  },

  /**
   * The demo's deals are a recorded snapshot, so there is exactly one page of
   * them. Page two is empty rather than a repeat of page one — an endless list
   * that quietly loops is worse than one that ends.
   */
  async deals(page: number) {
    return { deals: page === 0 ? (await snap()).ticker : [] };
  },

  async wishlist() {
    return { items: (await session()).wishlist };
  },

  async removeWish(id: number) {
    const state = await session();
    state.wishlist = state.wishlist.filter((w) => w.id !== id);
    return new Response(null, { status: 200 });
  },

  async trackDetail(id: number) {
    const s = await snap();
    const detail = s.trackDetail[String(id)];
    if (detail) return detail;
    // A game tracked during the visit has no recorded detail; build one from
    // what the snapshot does hold rather than failing the page.
    const state = await session();
    const item = state.wishlist.find((w) => w.id === id);
    return {
      id,
      title: item?.title ?? '',
      platform: item?.platform ?? 'pc',
      image: item?.image ?? null,
      preferredRegion: item?.preferred_region ?? null,
      hideDesc: false,
      meta: null,
      offers: [],
      history: [],
    } satisfies TrackDetail;
  },

  async trackStatus(title: string, platform: string) {
    const s = await snap();
    const state = await session();
    const recorded = s.trackStatus[`${title.toLowerCase()}|${platform}`];
    const live = state.wishlist.find(
      (w) => w.title.toLowerCase() === title.toLowerCase() && w.platform === platform
    );
    if (live) return { tracked: true, id: live.id, history: recorded?.history ?? [] };
    return { tracked: false, history: recorded?.history ?? [] };
  },

  async track(item: { title: string; platform: string; image?: string; refs: SourceRef[] }) {
    const s = await snap();
    const state = await session();
    const recorded = s.trackStatus[`${item.title.toLowerCase()}|${item.platform}`];
    const existing = state.wishlist.find(
      (w) => w.title.toLowerCase() === item.title.toLowerCase() && w.platform === item.platform
    );
    if (existing) return { id: existing.id, history: recorded?.history ?? [] };
    const id = state.nextId++;
    const cheapest = s.offers[`${item.platform}|${refsKey(item.refs)}`]?.offers?.[0];
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    state.wishlist.unshift({
      id,
      platform: item.platform as Platform,
      title: item.title,
      image: item.image ?? null,
      refs: item.refs,
      preferred_region: null,
      hide_desc: 0,
      capture_days: null,
      alert_mode: null,
      alert_pct: null,
      alert_price: null,
      alert_price_ccy: null,
      alert_scope: null,
      added_at: now,
      current: cheapest
        ? { store: cheapest.store, price_ils: cheapest.priceILS, checked_at: now, region: cheapest.region ?? null }
        : null,
      previous: null,
      physical: null,
      cdkeys: null,
      verdict: null,
    });
    return { id, history: recorded?.history ?? [] };
  },

  async trackRefresh(id: number) {
    const s = await snap();
    // Nothing to re-fetch without a server: hand back the history we hold.
    return { history: s.trackDetail[String(id)]?.history ?? [] };
  },

  async refresh() {
    return { updated: 0 };
  },

  async setTrackSetting(id, patch) {
    const state = await session();
    const item = state.wishlist.find((w) => w.id === id);
    if (item) {
      if (patch.preferredRegion !== undefined) item.preferred_region = patch.preferredRegion;
      if (patch.hideDesc !== undefined) item.hide_desc = patch.hideDesc ? 1 : 0;
      if (patch.captureDays !== undefined) item.capture_days = patch.captureDays;
      if (patch.alertPct !== undefined) item.alert_pct = patch.alertPct;
      if (patch.alertPrice !== undefined) item.alert_price = patch.alertPrice;
      if (patch.alertPriceCcy !== undefined) item.alert_price_ccy = patch.alertPriceCcy;
      if (patch.alertMode !== undefined) item.alert_mode = patch.alertMode;
      if (patch.alertScope !== undefined) item.alert_scope = patch.alertScope;
    }
    return { ok: true };
  },
  /** The demo's log is the same in-memory list; clearing the bell keeps it. */
  async getNotificationLog() {
    return { items: (await session()).notifications };
  },
  async purgeNotifications() {
    (await session()).notifications = [];
  },

  async getNotifications() {
    const state = await session();
    return { items: state.notifications, unread: state.notifications.filter((n) => !n.read).length };
  },

  async markNotificationsRead() {
    const state = await session();
    for (const n of state.notifications) n.read = 1;
    return new Response(null, { status: 200 });
  },

  async clearNotifications() {
    const state = await session();
    state.notifications = [];
    return new Response(null, { status: 200 });
  },

  async getSettings() {
    return (await session()).settings;
  },

  async setSettings(patch) {
    const state = await session();
    if (patch.captureDaysGlobal !== undefined) state.settings.captureDaysGlobal = patch.captureDaysGlobal;
    if (patch.displayCurrency !== undefined) {
      state.settings.displayCurrency = patch.displayCurrency as SettingsResponse['displayCurrency'];
    }
    if (patch.alerts) state.settings.alerts = { ...state.settings.alerts, ...patch.alerts };
    return state.settings;
  },

  async getKeys() {
    return (await session()).keys;
  },

  async setKeys(patch) {
    const state = await session();
    // A key entered here would go nowhere — there is no server to use it — so
    // the demo records only that one was set, never the value.
    if (patch.ggdeals !== undefined) state.keys.ggdeals = { configured: !!patch.ggdeals, source: patch.ggdeals ? 'settings' : 'none' };
    if (patch.itad !== undefined) state.keys.itad = { configured: !!patch.itad, source: patch.itad ? 'settings' : 'none' };
    return state.keys;
  },

  async getHealth() {
    return (await snap()).health;
  },

  async runHealth() {
    const s = await snap();
    return { report: s.health.report ?? { checkedAt: s.capturedAt, adapters: [] } };
  },

  async getPsnHash() {
    const s = await snap();
    return s.psnHash ?? { hash: '', source: 'builtin', browser: null };
  },

  async setPsnHash(hash: string) {
    return { ok: true, hash, source: 'saved' as const };
  },

  async recoverPsnHash() {
    const s = await snap();
    // Recovery drives a real browser on the server; there is no server here.
    return { found: null, hash: s.psnHash?.hash ?? '', source: s.psnHash?.source ?? 'builtin' };
  },

  async importData() {
    return { games: 0, points: 0 };
  },

  /**
   * The demo is a recorded snapshot with nowhere to write and no way out to
   * Valve. Saying so beats a button that appears to work and then does not.
   */
  async importSteam() {
    return { ok: false as const, reason: 'demo' };
  },

  /** The demo has no sources to diagnose and no database to count. */
  async diagnostics() {
    return { report: null, text: 'הדגמה — אין נתונים לאבחון.' };
  },

  // Bundles need a live Steam call; the demo is a recording.
  async bundles() {
    return { bundles: [] };
  },

  // The demo's bell is a recorded snapshot; there is nowhere to add to it.
  async notifyGamePass() {},

  // The demo has no tracked list of its own and nowhere to record a price.
  async refreshUnchecked() {
    return 0;
  },

  // Nothing tracked in the demo, so there is nothing to carry anywhere.
  async exportToken() {
    return { token: '' };
  },
  async importToken() {
    return null;
  },
};
