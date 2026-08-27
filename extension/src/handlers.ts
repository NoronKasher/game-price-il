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
import { tickerDeals, dealsPage } from '../../server/src/ticker.ts';
import { bundlesForApp } from '../../server/src/bundle.ts';
import { buildReport, renderReport } from '../../server/src/diagnostics.ts';
import { record } from '../../server/src/eventLog.ts';
import { encodeToken, decodeToken } from '../../server/src/portableToken.ts';
import {
  fetchWishlist,
  importWishlist,
  resolveProfile,
  type ImportSink,
} from '../../server/src/steamWishlist.ts';
import { runHealthCheck, lastHealthReport, healthCheckDue } from '../../server/src/health.ts';
import { hasApiKey, setApiKey, apiKeySource, type ApiKeyName } from './keys.browser.ts';
import { currentSearchHash, searchHashSource } from '../../server/src/adapters/psn.ts';
import { noteHashSaved } from './psnHash.browser.ts';
import {
  setSetting,
  getSetting,
  exportSettings,
  importSettings,
  trackedCounts,
  allSettings,
} from './db.browser.ts';
import {
  ready,
  flush,
  addToWishlist,
  removeFromWishlist,
  listWishlist,
  lastCheckedAt,
  addNotification,
  getWishlistRow,
  findWishlist,
  setPreferredRegion,
  setHideDesc,
  setCaptureDays,
  setNote,
  setAlert,
  setAlertMode,
  setAlertScope,
  listNotifications,
  listAllNotifications,
  purgeNotifications,
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
      note: row.note,
      added_at: row.added_at,
      current,
      previous,
      physical: physical ? { store: physical.store, price_ils: physical.price_ils } : null,
      cdkeys: cdkeys ? { store: cdkeys.store, price_ils: cdkeys.price_ils } : null,
      verdict: base ? { ...base, scope: regional.length > 0 ? 'official' : 'any' } : null,
    };
  });
}

/**
 * Every currency the settings picker can offer — the same list the server
 * sends, so both shells behave identically. The rate feed carries 166 in one
 * cached response, so asking for all of these costs nothing extra.
 */
const DISPLAY_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'TRY', 'UAH', 'ARS', 'BRL', 'INR', 'KZT', 'ZAR', 'MXN', 'PLN',
  'JPY', 'KRW', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'CNY', 'HKD', 'SGD', 'TWD', 'THB',
  'IDR', 'MYR', 'PHP', 'VND', 'CLP', 'COP', 'PEN', 'SAR', 'AED',
  // The wider set, offered only when the user switches it on. Sent regardless
  // because the rate feed returns all 166 in one cached response — asking for
  // these costs nothing, and fetching them only after the switch is flipped
  // would make every price on screen flicker at that moment.
  //
  // Deliberately absent: IRR, SYP, KPW, CUP, AFN, SDG, VES, MMK, BYN, LBP,
  // YER, SOS, LYD, IQD — each under a comprehensive embargo, an Israeli trade
  // prohibition, or with no convertible market, so a price in one describes a
  // purchase nobody reading this can lawfully make. RUB stays: sanctioned in
  // ways that affect payment rails, not a jurisdiction Israelis may not
  // transact with, and Steam still publishes rouble prices people compare to.
  'RUB', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RSD', 'ISK', 'DKK', 'NZD', 'EGP', 'MAD',
  'JOD', 'BHD', 'KWD', 'OMR', 'QAR', 'AZN', 'GEL', 'AMD', 'UZS', 'PKR', 'BDT', 'LKR',
  'NPR', 'KHR', 'MNT', 'NGN', 'KES', 'GHS', 'TZS', 'UGX', 'ETB', 'DZD', 'TND', 'BOB',
  'PYG', 'UYU', 'CRC', 'GTQ', 'DOP', 'JMD', 'TTD', 'MUR', 'MDL', 'MKD', 'ALL', 'BAM',
  'BWP', 'NAD', 'ZMW', 'XOF', 'XAF', 'FJD', 'PGK', 'BND', 'MOP', 'LAK', 'MVR',
];

async function settingsPayload() {
  // Rates are quoted per shekel, the currency every price is stored in.
  const rates: Record<string, number> = { ILS: 1 };
  await Promise.all(
    DISPLAY_CURRENCIES.map(async (code) => {
      try {
        const rate = await ilsTo(code);
        // ilsTo falls back to 1 for anything it cannot price, which would show
        // a foreign price as its shekel figure with the wrong symbol in front.
        if (rate > 0 && rate !== 1) rates[code] = rate;
      } catch {
        /* a currency the feed does not carry is simply not offered */
      }
    })
  );
  return {
    captureDaysGlobal: getCaptureDaysGlobal(),
    displayCurrency: getDisplayCurrency(),
    secondaryCurrency: getSetting('secondary_currency') || null,
    ratesFromILS: rates,
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
    /**
     * `emit` is supplied by background.ts only for a streaming call, and is what
     * turns the same fan-out into a progressive one — no second code path, and
     * no chance of the streamed and non-streamed searches drifting apart.
     */
    search: withDb((q: string, includeDlc = false, emit?: (p: unknown) => void) =>
      searchGames(sources, q, includeDlc, emit ? (progress) => emit(progress) : undefined)
    ),

    offers: withDb((refs: SourceRef[], platform: Platform, emit?: (p: unknown) => void) =>
      offersFor(sources, refs, platform, emit ? (progress) => emit(progress) : undefined)
    ),

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

    /**
     * Price the rows that have never been priced.
     *
     * A game reaches the list without a price whenever it arrived by something
     * other than the track button — a wishlist import, a shared file, a token
     * from another machine. Those rows read "טרם נבדק" and used to sit that way
     * until the six-hourly capture came round, which looks exactly like a
     * tracker that does not work.
     *
     * Not `refresh`: that re-prices everything, which is the wrong cost for a
     * list that mostly has prices already.
     */
    refreshUnchecked: withDb(async (emit?: (p: unknown) => void) => {
      const pending = listWishlist().filter((row) => lastCheckedAt(row.id) === null);
      emit?.({ total: pending.length, done: 0, updated: 0 });
      let updated = 0;
      for (let i = 0; i < pending.length; i++) {
        const row = pending[i]!;
        try {
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
            await evaluateAlerts(row);
            updated++;
          }
        } catch {
          // One game nobody can price must not stop the rest of the list.
        }
        emit?.({ total: pending.length, done: i + 1, title: row.title, updated });
      }
      await flush();
      refreshBadge();
      return updated;
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
          note?: string;
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
        // Sanitised inside setNote, and the sanitised value goes back — the
        // sanitiser is the authority on what a note is.
        let note: string | undefined;
        if ('note' in p) note = setNote(id, p.note);
        await flush();
        return note === undefined ? { ok: true } : { ok: true, note };
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
    getNotificationLog: withDb(() => ({ items: listAllNotifications() })),
    purgeNotifications: withDb(async () => {
      purgeNotifications();
      await flush();
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
      async (p: {
        captureDaysGlobal?: number;
        displayCurrency?: string;
        secondaryCurrency?: string | null;
        alerts?: Record<string, unknown>;
      }) => {
        if (typeof p.captureDaysGlobal === 'number') setCaptureDaysGlobal(p.captureDaysGlobal);
        if (p.displayCurrency) setDisplayCurrency(p.displayCurrency);
        // '' clears it — one currency again.
        if ('secondaryCurrency' in p) setSetting('secondary_currency', p.secondaryCurrency ?? '');
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
     * "Already on Game Pass" into the bell and the Settings log.
     *
     * The decision to raise it belongs to the page — whether the feature is on,
     * and whether this game was acknowledged, are preferences in that browser's
     * storage. This only puts the alert where every other alert goes.
     */
    notifyGamePass: withDb(async (title: string, platform: string, subscriptions: string[]) => {
      const names = Array.isArray(subscriptions) ? subscriptions.filter((s) => typeof s === 'string').slice(0, 4) : [];
      if (!title || names.length === 0) return { ok: false };
      addNotification({
        wishlistId: null,
        title: String(title).slice(0, 200),
        message: `כלול במנוי ${names.join(' · ')} — ייתכן שאין צורך לקנות אותו.`,
        priceILS: 0,
        kind: 'gamepass',
        platform: platform ? String(platform).slice(0, 20) : null,
        scope: null,
      });
      await flush();
      refreshBadge();
      return { ok: true };
    }),

    /** The tracked list as one pasteable string. Same code the server runs. */
    exportToken: withDb(async (withHistory = true, prefs?: Record<string, string>) => {
      const items = exportAll().map((item) => (withHistory ? item : { ...item, history: [] }));
      return { token: await encodeToken(items, prefs, exportSettings()) };
    }),

    importToken: withDb(async (token: string) => {
      const decoded = typeof token === 'string' ? await decodeToken(token) : null;
      // A bad paste is expected input. It comes back as null and the UI says so.
      if (!decoded) return null;
      const result = importAll(decoded.items);
      // Settings are applied here — they live in this database. The prefs go
      // back to the page, which owns those.
      const settings = importSettings(decoded.settings);
      await flush();
      return { ...result, prefs: decoded.prefs, settings };
    }),

    /**
     * Import a public Steam wishlist, same code as the server runs.
     *
     * steamWishlist.ts touches no `node:` anything, so it ports here unchanged;
     * only the sink differs (IndexedDB rather than SQLite). The call arrives on
     * the streaming port, which is what keeps this worker alive through an
     * import that can run for minutes — an open port counts as activity, so the
     * lifetime is exactly the work.
     */
    importSteam: withDb(async (profile: string, emit?: (p: unknown) => void) => {
      const steamId = await resolveProfile(String(profile ?? ''));
      if (!steamId) return { ok: false, reason: 'profile' };
      const entries = await fetchWishlist(steamId);
      // Valve answers 200 with nothing for an empty wishlist AND for a private
      // one. We cannot tell them apart, so we do not guess which it was.
      if (entries.length === 0) return { ok: false, reason: 'empty' };

      const tracked = new Set<string>();
      for (const row of listWishlist()) {
        try {
          for (const ref of JSON.parse(row.refs) as SourceRef[]) {
            if (ref.sourceId === 'steam-regional') tracked.add(ref.sourceGameId);
          }
        } catch {
          /* one malformed row must not stop an import */
        }
      }

      const sink: ImportSink = {
        has: (appId) => tracked.has(appId),
        add: (row) => {
          addToWishlist(row);
          tracked.add(row.refs[0]!.sourceGameId);
        },
      };

      emit?.({ total: entries.length, done: 0, added: 0, skipped: 0 });
      const outcome = await importWishlist(entries, sink, (p) => emit?.(p));
      await flush();
      refreshBadge();
      return { ok: true, ...outcome };
    }),

    /**
     * Today's deals. The one call in this whole tool that scrapes nothing:
     * CheapShark publishes a JSON API and opts into cross-origin use, so the
     * extension can make it exactly as the server does.
     */
    ticker: async (limit?: number) => ({ deals: await tickerDeals(limit) }),

    /**
     * A report the user can hand to somebody trying to help.
     *
     * Same builder the server uses, so both shells produce the same shape. The
     * environment block differs, because what is worth knowing differs: the
     * browser and the extension's own version, rather than Node's.
     */
    diagnostics: withDb(async (query?: string) => {
      let searchSample;
      const q = String(query ?? '').trim().slice(0, 80);
      if (q) {
        try {
          const result = await searchGames(sources, q, true);
          const hits = result.games.map((g) => ({
            sourceId: g.sourceId,
            title: g.title,
            groupKey: g.groupKey,
            platform: g.platform,
            dlc: g.dlc,
          }));
          const byKey = new Map<string, { key: string; titles: string[]; platforms: string[] }>();
          for (const h of hits) {
            const group = byKey.get(h.groupKey) ?? { key: h.groupKey, titles: [], platforms: [] };
            if (!group.titles.includes(h.title)) group.titles.push(h.title);
            if (!group.platforms.includes(h.platform)) group.platforms.push(h.platform);
            byKey.set(h.groupKey, group);
          }
          searchSample = { query: q, hits, groups: [...byKey.values()] };
        } catch (err) {
          record('error', 'diagnostics', err);
        }
      }

      const report = buildReport({
        shell: 'extension',
        version: chrome.runtime.getManifest().version,
        keysPresent: { ggdeals: hasApiKey('ggdeals'), itad: hasApiKey('itad') },
        health: lastHealthReport(),
        tracked: trackedCounts(),
        settings: allSettings(),
        environment: {
          browser: navigator.userAgent,
          language: navigator.language,
        },
        searchSample,
      });
      return { report, text: renderReport(report) };
    }),

    /** Bundles for a Steam game — same code the server runs. */
    bundles: async (appId: string) => {
      try {
        return { bundles: await bundlesForApp(String(appId)) };
      } catch {
        return { bundles: [] };
      }
    },

    /** One page of the merged deals feed — same code the server runs. */
    deals: async (page: number, limit: number) => ({ deals: await dealsPage(page, limit) }),

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
      // Not "no browser found" — the user is reading this IN a browser. An
      // extension has no way to start one and watch its requests, which is a
      // fact about extensions, not about their machine.
      recovery: 'manual' as const,
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
