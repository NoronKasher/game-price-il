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

/** Every game hit the snapshot knows about, across all recorded searches. */
function allHits(s: Snapshot): GameHit[] {
  const seen = new Set<string>();
  const out: GameHit[] = [];
  for (const response of Object.values(s.searches)) {
    for (const hit of response.games) {
      const k = `${hit.sourceId}:${hit.sourceGameId}:${hit.platform}`;
      if (seen.has(k)) continue;
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

export const api: typeof LiveApi = {
  async search(q: string, _includeDlc = false): Promise<SearchResponse> {
    const s = await snap();
    // Add-ons are deliberately absent from the snapshot (games only), so the
    // opt-in box has nothing extra to reveal here. See README → demo limits.
    void _includeDlc;
    return s.searches[q.trim().toLowerCase()] ?? searchFallback(s, q);
  },

  async offers(refs: SourceRef[], platform: string) {
    const s = await snap();
    const payload = s.offers[`${platform}|${refsKey(refs)}`];
    return { offers: payload?.offers ?? [], partial: payload?.partial, sources: payload?.sources ?? [] };
  },

  async meta(refs: SourceRef[]) {
    const s = await snap();
    return { meta: s.meta[refsKey(refs)] ?? null };
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
};
