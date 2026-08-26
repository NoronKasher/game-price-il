import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { parseQuery, type Platform } from './search.ts';
import { describeProduct, groupKey } from './normalize.ts';
import type { GameHit, Offer, SourceAdapter } from './adapters/types.ts';
import { asOffers } from './adapters/types.ts';
import {
  fetchWishlist,
  importWishlist,
  resolveProfile,
  type ImportSink,
} from './steamWishlist.ts';
import { cheapshark } from './adapters/cheapshark.ts';
import { steamRegional } from './adapters/steam.ts';
import { epic } from './adapters/epic.ts';
import { ubisoft } from './adapters/ubisoft.ts';
import { ea } from './adapters/ea.ts';
import { ggdeals } from './adapters/ggdeals.ts';
import { itad } from './adapters/itad.ts';
import { vgs } from './adapters/vgs.ts';
import { player1 } from './adapters/player1.ts';
import { arcadia } from './adapters/arcadia.ts';
import { gamestorm } from './adapters/gamestorm.ts';
import { ivory } from './adapters/ivory.ts';
import { bug } from './adapters/bug.ts';
import { xbox } from './adapters/xbox.ts';
import { nintendo } from './adapters/nintendo.ts';
import { psn } from './adapters/psn.ts';
import { gog } from './adapters/gog.ts';
import { RateLimitedError, setPoliteStore } from './adapters/politeFetch.ts';
import {
  addToWishlist,
  listWishlist,
  removeFromWishlist,
  recordOffers,
  bestPerCheck,
  bestPerCheckInRegion,
  latestCheapestOf,
  lastCheckedAt,
  fullOfferHistory,
  findWishlist,
  getWishlistRow,
  setPreferredRegion,
  setHideDesc,
  setCaptureDays,
  setAlert,
  setAlertMode,
  setAlertScope,
  getAlertDefaults,
  setAlertDefaults,
  listNotifications,
  unreadNotificationCount,
  markNotificationsRead,
  clearNotifications,
  listAllNotifications,
  purgeNotifications,
  getCaptureDaysGlobal,
  setCaptureDaysGlobal,
  getDisplayCurrency,
  setDisplayCurrency,
  exportAll,
  importAll,
  type SourceRef,
  type WishlistRow,
} from './db.ts';
import { steamMeta } from './adapters/steam.ts';
import { toILS, ilsTo } from './rates.ts';
import { hasApiKey, setApiKey, apiKeySource, type ApiKeyName } from './keys.ts';
import { isAlertMode, isAlertScope } from './alerts.ts';
import { evaluateAlerts } from './notify.ts';
import { captureFromView, isCaptureDue } from './capture.ts';
import { priceVerdict } from './verdict.ts';
import { isAllowedRequestOrigin, resolveListenConfig } from './net.ts';
import { suggestTitles } from './suggest.ts';
import { searchGames, offersFor, steamAppIdOf, ALL_PLATFORMS } from './fanout.ts';
import { historyCsv } from './csv.ts';
import { tickerDeals } from './ticker.ts';
import { runHealthCheck, lastHealthReport, healthCheckDue } from './health.ts';
import { currentSearchHash, searchHashSource } from './adapters/psn.ts';
import {
  discoverSearchHashShared,
  hashNeedsRecovery,
  noteHashSaved,
  probeBrowser,
  waitForHashSaved,
  HOST_RECOVER_MARKER,
} from './adapters/psnHash.ts';
import { setSetting } from './db.ts';
import { sqlitePoliteStore } from './politeStore.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Gentle spacing between games in a batch capture, so many tracked games don't
 *  burst the official APIs at once (physical stores are already paced by politeFetch). */
const GAME_GAP_MS = 1500;

/** Per-source outcome of a fan-out, so the UI can distinguish "no results" from "source broke". */
interface SourceStatus {
  id: string;
  name: string;
  ok: boolean;
  reason?: 'error' | 'rate_limited';
  count: number;
}

/** Classify a thrown error: a self-imposed rate-limit/back-off vs a genuine failure. */
function statusFor(source: SourceAdapter, err: unknown): SourceStatus {
  const rateLimited = err instanceof RateLimitedError;
  if (!rateLimited) console.error(`source ${source.id} failed:`, err);
  return { id: source.id, name: source.nameHe, ok: false, reason: rateLimited ? 'rate_limited' : 'error', count: 0 };
}

/** Source registry — adding a store means adding one adapter here. */
const sources: SourceAdapter[] = [
  cheapshark,
  steamRegional,
  epic,
  ubisoft,
  ea,
  ggdeals,
  itad,
  vgs,
  player1,
  arcadia,
  gamestorm,
  ivory,
  bug,
  psn,
  xbox,
  nintendo,
  gog,
];

// Before any adapter can fetch: point the rate limiter at storage that outlives
// this process. The desktop build starts at every login, and without this each
// boot handed itself a fresh daily budget for shops it had already spent one on.
setPoliteStore(sqlitePoliteStore);

const app = express();
app.use(express.json({ limit: '25mb' })); // imported tracking files can be large

/**
 * CSRF guard. This API has no auth and binds to localhost, so a malicious web
 * page the user happens to visit could otherwise fire cross-site POST/DELETE
 * requests at it (delete tracked games, trigger scraping, etc.). Reject any
 * state-changing request whose Origin isn't same-machine; our own app and
 * non-browser clients (no Origin) pass. Reads are harmless (no CORS = the other
 * site can't read the response) so GET/HEAD are left alone.
 */
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!isAllowedRequestOrigin(req.headers.origin, req.headers.host)) {
    return res.status(403).json({ error: 'cross-origin request rejected' });
  }
  next();
});

/**
 * Smart search: platform words in the query ("FIFA 2020 PS4", "פיפא פלייסטיישן")
 * narrow the results; otherwise all platforms are shown grouped per game.
 */
app.get('/api/search', async (req, res) => {
  const raw = String(req.query.q ?? '').trim();
  // Add-ons are hidden unless asked for. Someone searching a game wants the
  // game; someone hunting a season pass says so, and then gets it labelled.
  const includeDlc = req.query.dlc === '1';
  if (!raw) return res.json({ query: { title: '', platforms: [] }, games: [], sources: [] });
  res.json(await searchGames(sources, raw, includeDlc));
});

/**
 * The same search, streamed a source at a time.
 *
 * NDJSON rather than SSE: one JSON object per line, which the browser reads off
 * response.body with nothing but a TextDecoder — no EventSource, no reconnect
 * semantics we would then have to think about, and the exact same shape the
 * extension posts over its message port.
 *
 * The plain /api/search stays: the demo needs it, and a client that cannot
 * stream must still be able to search.
 */
app.get('/api/search/stream', async (req, res) => {
  const raw = String(req.query.q ?? '').trim();
  const includeDlc = req.query.dlc === '1';
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  // Proxies that buffer would defeat the entire point of this route.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  /** One JSON object per line — the "ND" in NDJSON. */
  const line = (obj: unknown) => res.write(`${JSON.stringify(obj)}\n`);

  if (!raw) {
    line({ type: 'done', query: { title: '', platforms: [] }, games: [], sources: [] });
    return res.end();
  }

  try {
    const result = await searchGames(sources, raw, includeDlc, (p) => {
      // `total` rides on every line rather than a separate opening message: the
      // count is only known once the sources are filtered by platform, which
      // happens inside the fan-out.
      line({ type: 'source', total: p.total, done: p.done, status: p.status, games: p.games });
    });
    line({ type: 'done', ...result });
  } catch (err) {
    line({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
  res.end();
});

/**
 * A game's prices, streamed per store — the same treatment as the search.
 *
 * Opening a game is a SECOND fan-out: the search asked "who has this game", this
 * asks "what does each of them charge". They cannot be collapsed into one — the
 * first returns dozens of games and pricing them all would be dozens of fan-outs
 * — but there is no reason to make the user wait for the slowest shop again with
 * nothing on screen.
 */
app.post('/api/offers/stream', async (req, res) => {
  const { refs, platform } = (req.body ?? {}) as { refs?: SourceRef[]; platform?: Platform };
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const line = (obj: unknown) => res.write(`${JSON.stringify(obj)}
`);

  if (!Array.isArray(refs) || refs.length === 0 || !platform) {
    line({ type: 'done', offers: [], partial: false, sources: [] });
    return res.end();
  }
  try {
    const result = await offersFor(sources, refs, platform, (p) => {
      line({ type: 'source', total: p.total, done: p.done, status: p.status, offers: p.offers, lows: p.lows, includedIn: p.includedIn });
    });
    line({ type: 'done', ...result });
  } catch (err) {
    line({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
  res.end();
});

/**
 * Fast title suggestions for the search box's autocomplete. Deliberately does
 * NOT touch the source fan-out — see suggest.ts.
 */
app.get('/api/suggest', async (req, res) => {
  const q = String(req.query.q ?? '');
  res.json({ suggestions: await suggestTitles(q) });
});

/**
 * Adapter health — which sources are actually returning data. GET reads the
 * stored report (no requests); POST forces a fresh round of real probes.
 */
app.get('/api/health', (_req, res) => {
  res.json({ report: lastHealthReport(), due: healthCheckDue() });
});
app.post('/api/health/run', async (_req, res) => {
  res.json({ report: await runHealthCheck(sources) });
});

/**
 * PlayStation's persisted-query hash: status, manual override, and a button to
 * re-discover it. The hash is a public value out of Sony's own JavaScript, not a
 * secret, so it is shown in full — seeing it is how a user confirms a fix.
 */
app.get('/api/psn-hash', async (_req, res) => {
  // The desktop shell recovers with the Chromium it already is (desktop/psnHash.js),
  // so it never needs — and never finds — an installed browser to drive. Saying
  // "no browser found" there would report a working feature as broken.
  const host = process.env.VGPT_HOST;
  const engine = host === 'desktop' ? null : await probeBrowser();
  res.json({
    hash: currentSearchHash(),
    source: searchHashSource(),
    browser: engine,
    recovery: host === 'desktop' ? 'self' : engine ? 'browser' : 'manual',
    // For a host that can drive a browser of its own — the desktop build asks
    // for this and goes and gets a fresh hash when it turns true.
    needsRecovery: hashNeedsRecovery(),
  });
});
app.patch('/api/psn-hash', (req, res) => {
  const raw = String((req.body ?? {}).hash ?? '').trim().toLowerCase();
  // Empty clears the override and falls back to env/built-in.
  if (!raw) {
    setSetting('psn_search_hash', '');
    return res.json({ ok: true, hash: currentSearchHash(), source: searchHashSource() });
  }
  if (!/^[a-f0-9]{64}$/.test(raw)) {
    return res.status(400).json({ error: 'a persisted-query hash is 64 hex characters' });
  }
  setSetting('psn_search_hash', raw);
  noteHashSaved();
  res.json({ ok: true, hash: currentSearchHash(), source: searchHashSource() });
});
app.post('/api/psn-hash/recover', async (_req, res) => {
  // In the desktop shell this server cannot do it — the bundle carries no
  // playwright — but the shell around it is a Chromium and can. Without this the
  // button reported failure on the one build where recovery genuinely works.
  if (process.env.VGPT_HOST === 'desktop') {
    console.log(HOST_RECOVER_MARKER);
    const saved = await waitForHashSaved(45_000);
    return res.json({
      found: saved ? currentSearchHash() : null,
      hash: currentSearchHash(),
      source: searchHashSource(),
    });
  }
  const found = await discoverSearchHashShared();
  res.json({ found, hash: currentSearchHash(), source: searchHashSource() });
});

/**
 * Seller board for one game+platform, merged across sources.
 * Body: { refs: [{sourceId, sourceGameId}], platform }
 */
app.post('/api/offers', async (req, res) => {
  const { refs, platform } = (req.body ?? {}) as { refs?: SourceRef[]; platform?: Platform };
  if (!Array.isArray(refs) || refs.length === 0 || !platform) {
    return res.status(400).json({ error: 'refs and platform required' });
  }
  res.json(await offersFor(sources, refs, platform));
});

/**
 * Steam description + genres for a searched game, so a result can show its info
 * without being tracked. `meta` is null when the game has no Steam ref (most
 * console-only titles) — the client then shows just art, title and platform.
 * Body: { refs: [{sourceId, sourceGameId}] }
 */
app.post('/api/meta', async (req, res) => {
  const { refs } = (req.body ?? {}) as { refs?: SourceRef[] };
  const appId = Array.isArray(refs) ? steamAppIdOf(refs) : null;
  const meta = appId ? await steamMeta(appId) : null;
  res.json({ meta });
});

app.get('/api/wishlist', (_req, res) => {
  const rows = listWishlist().map((row) => {
    // If the user pinned a region to track, the summary "best price" follows THAT
    // region's digital price. Fall back to the overall cheapest when no region is
    // pinned, or when the game isn't sold in the pinned region (so it's never blank).
    const regional = row.preferred_region ? bestPerCheckInRegion(row.id, row.preferred_region) : [];
    const history = regional.length > 0 ? regional : bestPerCheck(row.id);
    const current = history[0] ?? null;
    const previous = history.find((h) => current && h.checked_at !== current.checked_at) ?? null;
    // Alongside the in-platform (region) price, the cheapest disc and cheapest
    // keyshop/CD-key from the latest check (null when the game has neither).
    const physical = latestCheapestOf(row.id, 'physical');
    const cdkeys = latestCheapestOf(row.id, 'external');
    // "Is this a good price?" judged against this game's own record, on the very
    // same series the headline price comes from — so the verdict can never
    // disagree with the number printed beside it. `scope` says WHICH price it
    // judged: with a pinned region that's the official store, otherwise it's the
    // cheapest of everything. Without it, "cheapest ever ₪183" reads as a lie
    // when a ₪111 keyshop price sits on the next line.
    const base = priceVerdict(history);
    const verdict = base
      ? { ...base, scope: regional.length > 0 ? ('official' as const) : ('any' as const) }
      : null;
    return { ...row, refs: JSON.parse(row.refs) as SourceRef[], current, previous, physical, cdkeys, verdict };
  });
  res.json({ items: rows });
});

app.delete('/api/wishlist/:id', (req, res) => {
  removeFromWishlist(Number(req.params.id));
  res.json({ ok: true });
});

/** All current offers for a tracked game across its sources. */
async function currentOffersFor(item: WishlistRow): Promise<Offer[]> {
  const refs = JSON.parse(item.refs) as SourceRef[];
  const offers: Offer[] = [];
  for (const ref of refs) {
    const source = sources.find((s) => s.id === ref.sourceId);
    if (!source?.enabled) continue;
    try {
      offers.push(...asOffers(await source.getOffers(ref.sourceGameId, item.platform as Platform)));
    } catch (err) {
      console.error(`price check failed for wishlist #${item.id} via ${ref.sourceId}:`, err);
    }
  }
  return offers.sort((a, b) => a.priceILS - b.priceILS);
}

/** Record EVERY current offer (not just the cheapest) as one timestamped batch. */
async function recordAllFor(item: WishlistRow): Promise<number> {
  const offers = await currentOffersFor(item);
  recordOffers(
    item.id,
    offers.map((o) => ({
      store: o.store,
      region: o.region ?? null,
      kind: o.kind,
      price: o.price,
      currency: o.currency,
      priceILS: o.priceILS,
    }))
  );
  return offers.length;
}

/** Record a fresh point AND check the game's sale alerts. */
async function captureAndAlert(item: WishlistRow): Promise<number> {
  const n = await recordAllFor(item);
  try {
    await evaluateAlerts(item);
  } catch (err) {
    console.error(`alert check failed for #${item.id}:`, err);
  }
  return n;
}

/** Re-check every tracked game across all sources; store all offers. */
app.post('/api/refresh', async (_req, res) => {
  const items = listWishlist();
  let updated = 0;
  for (let i = 0; i < items.length; i++) {
    if ((await captureAndAlert(items[i]!)) > 0) updated++;
    if (i < items.length - 1) await sleep(GAME_GAP_MS); // don't burst the APIs
  }
  res.json({ updated, total: items.length });
});

/**
 * Opt-in tracking for one game: add it and record the first full set of offers —
 * only for this game, never the whole catalog.
 */
app.post('/api/track', async (req, res) => {
  const { title, platform, image, refs } = req.body ?? {};
  if (!title || !platform || !Array.isArray(refs) || refs.length === 0) {
    return res.status(400).json({ error: 'missing fields' });
  }
  const row = addToWishlist({ title, platform, image, refs });
  // Re-tracking a game already on the list (a second platform tab, a double
  // click, adding it again from search) used to append another full check
  // seconds after the first — junk duplicate points that flatten the graph's
  // time axis. Record only what the history doesn't already have.
  const offers = await currentOffersFor(row);
  await captureFromView(row, offers);
  res.json({ id: row.id, history: bestPerCheck(row.id) });
});

/** Is this game tracked, plus its cheapest-per-check line for the mini graph. */
app.get('/api/track/status', (req, res) => {
  const title = String(req.query.title ?? '');
  const platform = String(req.query.platform ?? '');
  const row = findWishlist(title, platform);
  if (!row) return res.json({ tracked: false, history: [] });
  res.json({ tracked: true, id: row.id, history: bestPerCheck(row.id) });
});

/** Add one fresh set of price points for a single tracked game (and check alerts). */
app.post('/api/track/:id/refresh', async (req, res) => {
  const row = getWishlistRow(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not tracked' });
  await captureAndAlert(row);
  res.json({ history: bestPerCheck(row.id) });
});

/** Per-game settings: preferred region, hide-description, capture interval, sale alerts. */
app.patch('/api/track/:id', (req, res) => {
  const row = getWishlistRow(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not tracked' });
  const body = req.body ?? {};
  if ('preferredRegion' in body) setPreferredRegion(row.id, body.preferredRegion ?? null);
  if ('hideDesc' in body) setHideDesc(row.id, !!body.hideDesc);
  if ('captureDays' in body) {
    // null / empty → clear the override (fall back to the global interval).
    const n = Number(body.captureDays);
    setCaptureDays(row.id, body.captureDays == null || body.captureDays === '' || !Number.isFinite(n)
      ? null
      : Math.max(1, Math.round(n)));
  }
  if ('alertPct' in body) {
    const n = Number(body.alertPct);
    setAlert(row.id, { pct: body.alertPct == null || body.alertPct === '' || !(n >= 1) ? null : Math.round(n) });
  }
  if ('alertPrice' in body) {
    const n = Number(body.alertPrice);
    const price = body.alertPrice == null || body.alertPrice === '' || !(n > 0) ? null : n;
    const ccy = ['ILS', 'USD', 'EUR'].includes(body.alertPriceCcy) ? body.alertPriceCcy : 'ILS';
    setAlert(row.id, { price, ccy });
  }
  // Follow the global rule / use this game's own thresholds / stay silent.
  if ('alertMode' in body && isAlertMode(body.alertMode)) setAlertMode(row.id, body.alertMode);
  // Which of this game's prices the alert watches; null → the global default.
  if ('alertScope' in body) {
    setAlertScope(row.id, isAlertScope(body.alertScope) ? body.alertScope : null);
  }
  res.json({ ok: true });
});

/** In-app sale-alert notifications: list + unread count, mark-read, clear. */
app.get('/api/notifications', (_req, res) => {
  res.json({ items: listNotifications(), unread: unreadNotificationCount() });
});
app.post('/api/notifications/read', (_req, res) => {
  markNotificationsRead();
  res.json({ ok: true });
});
/**
 * The Settings log: every alert ever raised, including ones dismissed from the
 * bell. DELETE here is the real thing and is guarded in the UI by a hold.
 */
app.get('/api/notifications/log', (_req, res) => {
  res.json({ items: listAllNotifications() });
});
app.delete('/api/notifications/log', (_req, res) => {
  purgeNotifications();
  res.json({ ok: true });
});

app.delete('/api/notifications', (_req, res) => {
  clearNotifications();
  res.json({ ok: true });
});

/** Global app settings: auto-capture interval + the display currency (with the
 *  ILS→currency rates the client uses to show every stored ILS price in it). */
async function settingsPayload() {
  const [usd, eur] = await Promise.all([ilsTo('USD'), ilsTo('EUR')]);
  return {
    captureDaysGlobal: getCaptureDaysGlobal(),
    displayCurrency: getDisplayCurrency(),
    ratesFromILS: { ILS: 1, USD: usd, EUR: eur },
    alerts: getAlertDefaults(),
  };
}
app.get('/api/settings', async (_req, res) => res.json(await settingsPayload()));

app.patch('/api/settings', async (req, res) => {
  const body = req.body ?? {};
  if ('captureDaysGlobal' in body) {
    const n = Number(body.captureDaysGlobal);
    if (Number.isFinite(n) && n >= 1) setCaptureDaysGlobal(n);
  }
  // The global sale-alert rule — what every tracked game is watched with.
  if ('alerts' in body && body.alerts && typeof body.alerts === 'object') {
    const a = body.alerts as Record<string, unknown>;
    const patch: Parameters<typeof setAlertDefaults>[0] = {};
    if ('pct' in a) {
      const n = Number(a.pct);
      patch.pct = a.pct == null || a.pct === '' || !(n >= 1) ? null : Math.round(n);
    }
    if ('price' in a) {
      const n = Number(a.price);
      patch.price = a.price == null || a.price === '' || !(n > 0) ? null : n;
    }
    if (typeof a.ccy === 'string') patch.ccy = a.ccy;
    if ('anyDrop' in a) patch.anyDrop = !!a.anyDrop;
    if (isAlertScope(a.scope)) patch.scope = a.scope;
    setAlertDefaults(patch);
  }
  if ('displayCurrency' in body) setDisplayCurrency(String(body.displayCurrency));
  res.json(await settingsPayload());
});

/**
 * BYOK API keys (GG.deals / ITAD). GET returns only status (configured? from
 * where?) — never the secret. PATCH saves a user-supplied key locally; an empty
 * value clears it (falling back to env/file if present).
 */
const KEY_NAMES: ApiKeyName[] = ['ggdeals', 'itad'];
function keyStatus() {
  return Object.fromEntries(
    KEY_NAMES.map((n) => [n, { configured: hasApiKey(n), source: apiKeySource(n) }])
  );
}
app.get('/api/keys', (_req, res) => res.json(keyStatus()));
app.patch('/api/keys', (req, res) => {
  const body = req.body ?? {};
  for (const name of KEY_NAMES) {
    if (name in body) setApiKey(name, typeof body[name] === 'string' ? body[name] : null);
  }
  res.json(keyStatus());
});

/** Full detail for a tracked game: current offers, all history series, meta. */
app.get('/api/track/:id/detail', async (req, res) => {
  const row = getWishlistRow(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'not tracked' });
  const refs = JSON.parse(row.refs) as SourceRef[];
  const [offers, meta] = await Promise.all([
    currentOffersFor(row),
    (async () => {
      const appId = steamAppIdOf(refs);
      return appId ? await steamMeta(appId) : null;
    })(),
  ]);
  // The live offers this view just fetched become a history point when they say
  // anything new (capture.ts) — recorded BEFORE the history read below, so the
  // graph in the response already includes today's prices from every source.
  const captured = await captureFromView(row, offers);
  res.json({
    id: row.id,
    title: row.title,
    platform: row.platform,
    image: row.image,
    preferredRegion: row.preferred_region,
    hideDesc: !!row.hide_desc,
    meta, // { description, genres[], image } | null
    offers,
    captured,
    history: fullOfferHistory(row.id),
  });
});

/** Download all tracked games + history as a shareable, re-importable file. */
app.get('/api/export', (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="game-price-tracking.json"');
  res.json({ version: 1, exportedAt: new Date().toISOString(), items: exportAll() });
});

/**
 * The same tracked history as a spreadsheet. The JSON export is for re-importing
 * into the tool; this is for opening in Sheets or Excel.
 */
app.get('/api/export.csv', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="game-price-history.csv"');
  res.send(historyCsv());
});

/** Merge a shared tracking file into the local database (input is sanitised in importAll). */
app.post('/api/import', (req, res) => {
  res.json(importAll(req.body));
});

/**
 * Import a public Steam wishlist.
 *
 * Streamed, because it is genuinely slow and lying about that would be worse:
 * Valve retired the bulk app-list endpoint, so every title costs its own small
 * request and they are spaced on purpose (see steamWishlist.ts). The user
 * watches it fill instead of staring at a spinner for three minutes.
 *
 * Nothing here logs in or scrapes. The wishlist endpoint is Valve's own, needs
 * no key, and answers only for profiles their owner has left public.
 */
app.post('/api/import/steam', async (req, res) => {
  const { profile } = (req.body ?? {}) as { profile?: string };
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const line = (obj: unknown) => res.write(JSON.stringify(obj) + '\n');

  try {
    const steamId = await resolveProfile(String(profile ?? ''));
    if (!steamId) {
      line({ type: 'error', reason: 'profile' });
      return res.end();
    }
    const entries = await fetchWishlist(steamId);
    if (entries.length === 0) {
      // Valve answers 200 with nothing both for an empty wishlist and for a
      // private one. We cannot tell them apart, so we do not guess.
      line({ type: 'error', reason: 'empty' });
      return res.end();
    }

    // The tracked list, read once: asking the database per app would be a query
    // per game for a fact that cannot change mid-import.
    const tracked = new Set<string>();
    for (const row of listWishlist()) {
      try {
        for (const ref of JSON.parse(row.refs) as SourceRef[]) {
          if (ref.sourceId === 'steam-regional') tracked.add(ref.sourceGameId);
        }
      } catch {
        /* a malformed refs column must not stop an import */
      }
    }

    const sink: ImportSink = {
      has: (appId) => tracked.has(appId),
      add: (row) => {
        addToWishlist(row);
        tracked.add(row.refs[0]!.sourceGameId);
      },
    };

    line({ type: 'start', total: entries.length });
    const outcome = await importWishlist(entries, sink, (p) => line({ type: 'progress', ...p }));
    line({ type: 'done', ...outcome });
  } catch (err) {
    line({ type: 'error', reason: 'failed', message: err instanceof Error ? err.message : String(err) });
  }
  res.end();
});

/** Ticker of today's deals worth caring about — see ticker.ts for what it picks. */
app.get('/api/ticker', async (_req, res) => {
  res.json({ deals: await tickerDeals() });
});

/**
 * Automatic price capture: record a fresh point for a tracked game once its
 * capture interval has elapsed — the per-game `capture_days` override, or the
 * global default (7 days) otherwise. We check periodically and only touch games
 * that are actually due, so a game set to "every 7 days" is scraped weekly, not
 * every few hours. Runs only for games the user chose to track.
 */
const CAPTURE_CHECK_MS = 6 * 60 * 60 * 1000; // how often we look for due games

const isDue = (item: WishlistRow, globalDays: number): boolean =>
  isCaptureDue(lastCheckedAt(item.id), item.capture_days, globalDays);

async function autoCapture(): Promise<void> {
  const items = listWishlist();
  if (items.length === 0) return;
  const globalDays = getCaptureDaysGlobal();
  const due = items.filter((it) => isDue(it, globalDays));
  if (due.length === 0) return;
  console.log(`auto-capture: ${due.length}/${items.length} tracked game(s) due…`);
  for (let i = 0; i < due.length; i++) {
    try {
      await captureAndAlert(due[i]!);
    } catch (err) {
      console.error(`auto-capture failed for #${due[i]!.id}:`, err);
    }
    if (i < due.length - 1) await sleep(GAME_GAP_MS); // gentle on the APIs
  }
}
setInterval(autoCapture, CAPTURE_CHECK_MS);

/**
 * Health canary, on the same lazy schedule as auto-capture: we look often but
 * only actually probe when a day has passed (see MIN_INTERVAL_MS), so a server
 * left running does not re-poll every store every few hours.
 */
async function autoHealth(): Promise<void> {
  if (!healthCheckDue()) return;
  try {
    const report = await runHealthCheck(sources);
    const bad = report.adapters.filter((a) => a.state === 'empty' || a.state === 'error');
    console.log(
      `health: ${report.adapters.length - bad.length}/${report.adapters.length} sources ok` +
        (bad.length ? ` — check ${bad.map((b) => b.id).join(', ')}` : '')
    );
  } catch (err) {
    console.error('health check failed:', err);
  }
}
setInterval(autoHealth, CAPTURE_CHECK_MS);
// Also shortly after startup, so a tool that isn't always on still fills in due
// points when it's reopened (the interval guard keeps this from over-scraping).
setTimeout(autoCapture, 60 * 1000);
setTimeout(autoHealth, 5 * 60 * 1000);

/**
 * Production/demo mode: when the web app has been built (npm run build), this
 * server also serves it — one process, one URL, so the whole tool can run on a
 * free host (Render and friends). API routes stay untouched; anything else gets
 * the SPA's index.html. In dev there is no dist/ and Vite serves the app.
 */
// VGPT_WEB_DIR lets a packaged desktop build point at wherever it put the UI;
// unset, this is the repo layout the server has always assumed.
const webDist = process.env.VGPT_WEB_DIR
  ? path.resolve(process.env.VGPT_WEB_DIR)
  : path.join(import.meta.dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(webDist, 'index.html'));
  });
  console.log('serving built web app from', webDist);
}

const { port, host, production } = resolveListenConfig();
app.listen(port, host, () =>
  console.log(`VGPT.IL server on http://${host}:${port}${production ? ' (production)' : ''}`)
);
