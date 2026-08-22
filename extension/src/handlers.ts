import { searchGames, offersFor } from '../../server/src/fanout.ts';
import type { SourceRef } from '../../server/src/fanout.ts';
import type { Platform } from '../../server/src/search.ts';
import type { SourceAdapter } from '../../server/src/adapters/types.ts';
import { priceVerdict } from '../../server/src/verdict.ts';
import { evaluateAlerts } from '../../server/src/notify.ts';
import { historyCsv } from '../../server/src/csv.ts';
import { steamMeta } from '../../server/src/adapters/steam.ts';
import { steamAppIdOf } from '../../server/src/fanout.ts';
import { ilsTo } from '../../server/src/rates.ts';
import { refreshBadge } from './badge.ts';
import { tickerDeals } from '../../server/src/ticker.ts';
import { runHealthCheck, lastHealthReport, healthCheckDue } from '../../server/src/health.ts';
import { hasApiKey, setApiKey, apiKeySource, type ApiKeyName } from './keys.browser.ts';
import { currentSearchHash, searchHashSource } from '../../server/src/adapters/psn.ts';
import { noteHashSaved } from './psnHash.browser.ts';
import { setSetting } from './db.browser.ts';
import {
  ready,
  flush,
  addToWishlist,
  removeFromWishlist,
  listWishlist,
  getWishlistRow,
  findWishlist,
  setPreferredRegion,
  setHideDesc,
  setCaptureDays,
  setAlert,
  setAlertMode,
  setAlertScope,
  listNotifications,
  unreadNotificationCount,
  markNotificationsRead,
  clearNotifications,
  getCaptureDaysGlobal,
  setCaptureDaysGlobal,
  getAlertDefaults,
  setAlertDefaults,
  getDisplayCurrency,
  setDisplayCurrency,
  recordOffers,
  bestPerCheck,
  bestPerCheckInRegion,
  latestCheapestOf,
  fullOfferHistory,
  exportAll,
  importAll,
  type WishlistRow,
} from './db.browser.ts';
import { politeSnapshot } from './politeStorage.ts';

/**
 * Everything the UI can ask the worker to do.
 *
 * These are the Express route bodies with the HTTP taken off — same storage
 * calls, same shapes, because the client on the other end is the same React app
 * that talks to the server. Where a route did real work beyond a database call,
 * that work lives in a shared module (fanout, verdict, notify, csv) and is
 * imported here rather than rewritten.
 */

export type Handler = (...args: never[]) => Promise<unknown>;

const refsOf = (row: WishlistRow): SourceRef[] => JSON.parse(row.refs) as SourceRef[];

/** The wishlist summary the tracking list renders — mirrors GET /api/wishlist. */
function wishlistPayload() {
  return listWishlist().map((row) => {
    // A pinned region means the headline price follows THAT region's store, not
    // the global cheapest — falling back when the game isn't sold there, so the
    // line is never blank.
    const regional = row.preferred_region ? bestPerCheckInRegion(row.id, row.preferred_region) : [];
    const history = regional.length > 0 ? regional : bestPerCheck(row.id);
    const current = history[0] ?? null;
    const previous = history.find((h) => current && h.checked_at !== current.checked_at) ?? null;
    const physical = latestCheapestOf(row.id, 'physical');
    const cdkeys = latestCheapestOf(row.id, 'external');
    const base = priceVerdict(history);
    return {
      id: row.id,
      platform: row.platform,
      title: row.title,
      image: row.image,
      refs: refsOf(row),
      preferred_region: row.preferred_region,
      hide_desc: row.hide_desc,
      capture_days: row.capture_days,
      alert_mode: row.alert_mode,
      alert_pct: row.alert_pct,
      alert_price: row.alert_price,
      alert_price_ccy: row.alert_price_ccy,
      alert_scope: row.alert_scope,
      added_at: row.added_at,
      current,
      previous,
      physical: physical ? { store: physical.store, price_ils: physical.price_ils } : null,
      cdkeys: cdkeys ? { store: cdkeys.store, price_ils: cdkeys.price_ils } : null,
      verdict: base ? { ...base, scope: regional.length > 0 ? 'official' : 'any' } : null,
    };
  });
}

async function settingsPayload() {
  // Rates are quoted per shekel, the currency every price is stored in.
  const [usd, eur] = await Promise.all([ilsTo('USD'), ilsTo('EUR')]);
  return {
    captureDaysGlobal: getCaptureDaysGlobal(),
    displayCurrency: getDisplayCurrency(),
    ratesFromILS: { ILS: 1, USD: usd, EUR: eur },
    alerts: getAlertDefaults(),
  };
}

/** The two bring-your-own-key sources, and how each is currently supplied. */
const KEY_NAMES: ApiKeyName[] = ['ggdeals', 'itad'];
const keyStatus = () =>
  Object.fromEntries(KEY_NAMES.map((n) => [n, { configured: hasApiKey(n), source: apiKeySource(n) }]));

export function makeHandlers(sources: SourceAdapter[]): Record<string, Handler> {
  /** Every call loads storage first; the worker may have been killed since the last one. */
  const withDb =
    <A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) =>
    async (...args: A): Promise<R> => {
      await ready();
      return fn(...args);
    };

  const handlers = {
    search: withDb((q: string, includeDlc = false) => searchGames(sources, q, includeDlc)),

    offers: withDb((refs: SourceRef[], platform: Platform) => offersFor(sources, refs, platform)),

    meta: withDb(async (refs: SourceRef[]) => {
      const appId = Array.isArray(refs) ? steamAppIdOf(refs) : null;
      return { meta: appId ? await steamMeta(appId) : null };
    }),

    wishlist: withDb(() => ({ items: wishlistPayload() })),

    removeWish: withDb(async (id: number) => {
      removeFromWishlist(id);
      await flush();
      return { ok: true };
    }),

    /** Start tracking a game, recording its current prices as the first point. */
    track: withDb(
      async (item: { title: string; platform: Platform; image?: string; refs: SourceRef[] }) => {
        const row = addToWishlist(item);
        const { offers } = await offersFor(sources, item.refs, item.platform);
        if (offers.length > 0) {
          recordOffers(
            row.id,
            offers.map((o) => ({
              store: o.store,
              region: o.region ?? null,
              kind: o.kind ?? null,
              price: o.price,
              currency: o.currency,
              priceILS: o.priceILS,
            }))
          );
        }
        await flush();
        return { id: row.id, history: bestPerCheck(row.id) };
      }
    ),

    trackStatus: withDb((title: string, platform: string) => {
      const row = findWishlist(title, platform);
      return row ? { tracked: true, id: row.id, history: bestPerCheck(row.id) } : { tracked: false, history: [] };
    }),

    trackDetail: withDb(async (id: number) => {
      const row = getWishlistRow(id);
      if (!row) throw new Error('not tracked');
      const refs = refsOf(row);
      const { offers } = await offersFor(sources, refs, row.platform as Platform);
      const appId = steamAppIdOf(refs);
      return {
        id: row.id,
        title: row.title,
        platform: row.platform,
        image: row.image,
        preferredRegion: row.preferred_region,
        hideDesc: Boolean(row.hide_desc),
        meta: appId ? await steamMeta(appId) : null,
        offers,
        history: fullOfferHistory(row.id),
      };
    }),

    /** Re-price one game and record the result. */
    trackRefresh: withDb(async (id: number) => {
      const row = getWishlistRow(id);
      if (!row) throw new Error('not tracked');
      const { offers } = await offersFor(sources, refsOf(row), row.platform as Platform);
      if (offers.length > 0) {
        recordOffers(
          row.id,
          offers.map((o) => ({
            store: o.store,
            region: o.region ?? null,
            kind: o.kind ?? null,
            price: o.price,
            currency: o.currency,
            priceILS: o.priceILS,
          }))
        );
        // Alerts are evaluated on the same rows that were just recorded, so a
        // notification can never describe a price the history does not hold.
        await evaluateAlerts(row);
      }
      await flush();
      return { history: fullOfferHistory(row.id) };
    }),

    /** Re-price everything tracked, one game at a time. */
    refresh: withDb(async () => {
      let updated = 0;
      for (const row of listWishlist()) {
        try {
          const { offers } = await offersFor(sources, refsOf(row), row.platform as Platform);
          if (offers.length === 0) continue;
          recordOffers(
            row.id,
            offers.map((o) => ({
              store: o.store,
              region: o.region ?? null,
              kind: o.kind ?? null,
              price: o.price,
              currency: o.currency,
              priceILS: o.priceILS,
            }))
          );
          await evaluateAlerts(row);
          updated++;
        } catch {
          // One game failing must not abandon the rest of the list.
        }
      }
      await flush();
      return { updated };
    }),

    setTrackSetting: withDb(
      async (
        id: number,
        p: {
          preferredRegion?: string | null;
          hideDesc?: boolean;
          captureDays?: number | null;
          alertPct?: number | null;
          alertPrice?: number | null;
          alertPriceCcy?: string;
          alertMode?: 'global' | 'custom' | 'off';
          alertScope?: string | null;
        }
      ) => {
        if ('preferredRegion' in p) setPreferredRegion(id, p.preferredRegion ?? null);
        if ('hideDesc' in p) setHideDesc(id, Boolean(p.hideDesc));
        if ('captureDays' in p) setCaptureDays(id, p.captureDays ?? null);
        if ('alertPct' in p || 'alertPrice' in p) {
          setAlert(id, { pct: p.alertPct, price: p.alertPrice, ccy: p.alertPriceCcy });
        }
        if (p.alertMode) setAlertMode(id, p.alertMode);
        if ('alertScope' in p) setAlertScope(id, (p.alertScope ?? null) as never);
        await flush();
        return { ok: true };
      }
    ),

    getNotifications: withDb(() => ({ items: listNotifications(), unread: unreadNotificationCount() })),
    markNotificationsRead: withDb(async () => {
      markNotificationsRead();
      await flush();
      // The toolbar badge is the only sign a background capture leaves; reading
      // the bell is what makes it stale.
      refreshBadge();
      return { ok: true };
    }),
    clearNotifications: withDb(async () => {
      clearNotifications();
      await flush();
      refreshBadge();
      return { ok: true };
    }),

    getSettings: withDb(() => settingsPayload()),
    setSettings: withDb(
      async (p: { captureDaysGlobal?: number; displayCurrency?: string; alerts?: Record<string, unknown> }) => {
        if (typeof p.captureDaysGlobal === 'number') setCaptureDaysGlobal(p.captureDaysGlobal);
        if (p.displayCurrency) setDisplayCurrency(p.displayCurrency);
        if (p.alerts) setAlertDefaults(p.alerts as never);
        await flush();
        return settingsPayload();
      }
    ),

    exportJson: withDb(() => exportAll()),
    exportCsv: withDb(() => historyCsv()),
    importData: withDb(async (items: unknown) => {
      const result = importAll(items);
      await flush();
      return result;
    }),

    /**
     * Today's deals. The one call in this whole tool that scrapes nothing:
     * CheapShark publishes a JSON API and opts into cross-origin use, so the
     * extension can make it exactly as the server does.
     */
    ticker: async () => ({ deals: await tickerDeals() }),

    /**
     * The adapter canary. GET reads the stored report and makes no requests;
     * running one is sixteen real probe searches, so — unlike the server, which
     * schedules it — here it happens only when a person presses the button.
     * Every user's browser probing every store on a timer would multiply one
     * server's daily canary by the size of the userbase.
     */
    getHealth: withDb(() => ({ report: lastHealthReport(), due: healthCheckDue() })),
    runHealth: withDb(async () => {
      const report = await runHealthCheck(sources);
      await flush();
      return { report };
    }),

    /** Bring-your-own-key for GG.deals and ITAD, held in chrome.storage. */
    getKeys: withDb(() => keyStatus()),
    setKeys: withDb(async (patch: Partial<Record<ApiKeyName, string>>) => {
      for (const name of KEY_NAMES) {
        if (name in patch) setApiKey(name, typeof patch[name] === 'string' ? patch[name]! : null);
      }
      return keyStatus();
    }),

    /**
     * PlayStation's persisted-query hash.
     *
     * Reading and pasting one work here exactly as on the server — which
     * matters, because until now an extension user whose hash had rotated had
     * no way at all to fix it, while a server user could paste a fresh one in
     * half a minute. What is still missing is the automatic recovery: that means
     * running the store's own page and watching the request it makes, which the
     * desktop build does with its own Chromium (desktop/psnHash.js) and an
     * extension cannot do without observing requests it has no permission for.
     */
    getPsnHash: withDb(() => ({
      hash: currentSearchHash(),
      source: searchHashSource(),
      browser: null,
    })),
    setPsnHash: withDb(async (hash: string) => {
      const raw = String(hash ?? '').trim().toLowerCase();
      if (raw && !/^[a-f0-9]{64}$/.test(raw)) {
        throw new Error('a persisted-query hash is 64 hex characters');
      }
      setSetting('psn_search_hash', raw);
      if (raw) noteHashSaved();
      await flush();
      return { ok: true, hash: currentSearchHash(), source: searchHashSource() };
    }),

    /** What the limiter currently owes each store — proof the state is real. */
    politeState: async () => politeSnapshot(),

    sources: async () => sources.map((s) => ({ id: s.id, name: s.nameHe, platforms: s.platforms })),
  };

  return handlers as unknown as Record<string, Handler>;
}
