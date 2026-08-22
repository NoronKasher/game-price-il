import { sanitizeImport } from '../../server/src/importGuard.ts';
import { isAlertScope, type AlertMode, type AlertRule, type AlertScope } from '../../server/src/alerts.ts';

/**
 * Storage for the extension build — the same surface as server/src/db.ts, over
 * IndexedDB instead of SQLite.
 *
 * Aliased in place of db.ts by the extension's Vite config, so capture, alerts,
 * notifications, CSV export and the suggestion list all keep working unchanged;
 * only the layer underneath them changes.
 *
 * The tables are held in memory and written back after every change. That would
 * be indefensible at database scale and is entirely reasonable here: a tracking
 * list is tens of games and a few thousand price points — the real one is 90KB —
 * and every query in this module is "one game's history, grouped by check". The
 * alternative, hand-writing cursor-based IndexedDB queries for each, would be
 * far more code and far more places to diverge from what the server does.
 *
 * The service worker dies constantly, so nothing may be assumed to survive in
 * memory: `ready()` reloads from IndexedDB on each wake-up, and callers await it
 * once before any work.
 */

/* ── Row shapes (identical to the SQLite ones) ────────────────────────────── */

export interface SourceRef {
  sourceId: string;
  sourceGameId: string;
}

export interface WishlistRow {
  id: number;
  title: string;
  platform: string;
  image: string | null;
  refs: string;
  preferred_region: string | null;
  hide_desc: number;
  capture_days: number | null;
  alert_mode: string | null;
  alert_pct: number | null;
  alert_price: number | null;
  alert_price_ccy: string | null;
  alert_scope: string | null;
  added_at: string;
}

export interface NotificationRow {
  id: number;
  wishlist_id: number | null;
  title: string;
  message: string;
  price_ils: number | null;
  kind: string | null;
  platform: string | null;
  scope: string | null;
  read: number;
  created_at: string;
}

export interface HistoryPoint {
  store: string;
  region: string | null;
  kind: string | null;
  price: number;
  currency: string;
  price_ils: number;
  checked_at: string;
}

/** A stored history row — HistoryPoint plus the keys SQLite kept for us. */
interface HistoryRow extends HistoryPoint {
  id: number;
  wishlist_id: number;
}

export interface OfferPoint {
  store: string;
  region?: string | null;
  kind?: string | null;
  price: number;
  currency: string;
  priceILS: number;
}

interface Tables {
  wishlist: WishlistRow[];
  history: HistoryRow[];
  notifications: NotificationRow[];
  settings: Record<string, string>;
  nextId: { wishlist: number; history: number; notification: number };
}

function empty(): Tables {
  return {
    wishlist: [],
    history: [],
    notifications: [],
    settings: {},
    nextId: { wishlist: 1, history: 1, notification: 1 },
  };
}

let tables: Tables = empty();

/* ── Persistence ──────────────────────────────────────────────────────────── */

const DB_NAME = 'vgpt';
const STORE = 'tables';
const KEY = 'v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function load(): Promise<Tables> {
  const db = await openDb();
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as Tables | undefined) ?? empty());
    req.onerror = () => resolve(empty());
  });
}

let writing: Promise<void> | null = null;
let dirty = false;

/**
 * Writes are coalesced but never dropped: recordOffers inserts a whole check's
 * offers one row at a time, and persisting each separately would be dozens of
 * transactions for one logical change. A write that lands while another is in
 * flight sets the flag and is picked up straight after, so the last state always
 * reaches disk even though the worker may be killed moments later.
 */
function save(): void {
  dirty = true;
  if (writing) return;
  writing = (async () => {
    while (dirty) {
      dirty = false;
      const snapshot = structuredClone(tables);
      const db = await openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(snapshot, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    writing = null;
  })();
}

/** Flush any pending write — for callers that must not lose the last change. */
export function flush(): Promise<void> {
  return writing ?? Promise.resolve();
}

let loading: Promise<void> | null = null;

/** Load the tables. Every entry point awaits this before touching the data. */
export function ready(): Promise<void> {
  loading ??= load().then((t) => {
    tables = { ...empty(), ...t };
  });
  return loading;
}

/* ── Time, in the format SQLite's datetime('now') produced ────────────────── */

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/* ── Wishlist ─────────────────────────────────────────────────────────────── */

export function addToWishlist(item: {
  title: string;
  platform: string;
  image?: string;
  refs: SourceRef[];
}): WishlistRow {
  const existing = tables.wishlist.find((r) => r.title === item.title && r.platform === item.platform);
  if (existing) {
    // Merge refs so re-adding after new sources appear enriches the row.
    const merged = [...(JSON.parse(existing.refs) as SourceRef[])];
    for (const ref of item.refs) {
      if (!merged.some((r) => r.sourceId === ref.sourceId && r.sourceGameId === ref.sourceGameId)) {
        merged.push(ref);
      }
    }
    existing.refs = JSON.stringify(merged);
    existing.image ??= item.image ?? null;
    save();
    return { ...existing };
  }

  const row: WishlistRow = {
    id: tables.nextId.wishlist++,
    title: item.title,
    platform: item.platform,
    image: item.image ?? null,
    refs: JSON.stringify(item.refs),
    preferred_region: null,
    hide_desc: 0,
    capture_days: null,
    alert_mode: null,
    alert_pct: null,
    alert_price: null,
    alert_price_ccy: null,
    alert_scope: null,
    added_at: now(),
  };
  tables.wishlist.push(row);
  save();
  return { ...row };
}

export function removeFromWishlist(id: number): void {
  tables.wishlist = tables.wishlist.filter((r) => r.id !== id);
  tables.history = tables.history.filter((h) => h.wishlist_id !== id);
  save();
}

export function listWishlist(): WishlistRow[] {
  return [...tables.wishlist].sort((a, b) => (a.added_at < b.added_at ? 1 : a.added_at > b.added_at ? -1 : 0));
}

function patch(id: number, apply: (row: WishlistRow) => void): void {
  const row = tables.wishlist.find((r) => r.id === id);
  if (!row) return;
  apply(row);
  save();
}

export function setPreferredRegion(id: number, region: string | null): void {
  patch(id, (r) => (r.preferred_region = region));
}

export function setHideDesc(id: number, hide: boolean): void {
  patch(id, (r) => (r.hide_desc = hide ? 1 : 0));
}

export function setCaptureDays(id: number, days: number | null): void {
  patch(id, (r) => (r.capture_days = days));
}

export function setAlert(
  id: number,
  a: { pct?: number | null; price?: number | null; ccy?: string | null }
): void {
  if ('pct' in a) patch(id, (r) => (r.alert_pct = a.pct ?? null));
  if ('price' in a) {
    patch(id, (r) => {
      r.alert_price = a.price ?? null;
      r.alert_price_ccy = a.price != null ? (a.ccy ?? 'ILS') : null;
    });
  }
  // A threshold with no mode change would sit in the row doing nothing while the
  // global rule ran instead.
  if (a.pct != null || a.price != null) setAlertMode(id, 'custom');
}

export function setAlertMode(id: number, mode: AlertMode): void {
  patch(id, (r) => (r.alert_mode = mode));
}

export function setAlertScope(id: number, scope: AlertScope | null): void {
  patch(id, (r) => (r.alert_scope = scope));
}

export function getWishlistRow(id: number): WishlistRow | undefined {
  if (!Number.isFinite(id)) return undefined;
  const row = tables.wishlist.find((r) => r.id === id);
  return row ? { ...row } : undefined;
}

export function findWishlist(title: string, platform: string): WishlistRow | undefined {
  const row = tables.wishlist.find((r) => r.title === title && r.platform === platform);
  return row ? { ...row } : undefined;
}

/* ── Notifications ────────────────────────────────────────────────────────── */

const MAX_NOTIFICATIONS = 200;

/** Newest first, matching `ORDER BY created_at DESC, id DESC`. */
function byNewest(a: NotificationRow, b: NotificationRow): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return b.id - a.id;
}

export function addNotification(n: {
  wishlistId: number;
  title: string;
  message: string;
  priceILS: number;
  kind: string;
  platform?: string | null;
  scope?: string | null;
}): void {
  tables.notifications.push({
    id: tables.nextId.notification++,
    wishlist_id: n.wishlistId,
    title: n.title,
    message: n.message,
    price_ils: n.priceILS,
    kind: n.kind,
    platform: n.platform ?? null,
    scope: n.scope ?? null,
    read: 0,
    created_at: now(),
  });
  // Keep the log bounded so it can't grow without limit over time.
  if (tables.notifications.length > MAX_NOTIFICATIONS) {
    tables.notifications = [...tables.notifications].sort(byNewest).slice(0, MAX_NOTIFICATIONS);
  }
  save();
}

export function listNotifications(limit = 50): NotificationRow[] {
  return [...tables.notifications].sort(byNewest).slice(0, limit);
}

export function unreadNotificationCount(): number {
  return tables.notifications.filter((n) => !n.read).length;
}

export function markNotificationsRead(): void {
  for (const n of tables.notifications) n.read = 1;
  save();
}

export function clearNotifications(): void {
  tables.notifications = [];
  save();
}

/* ── Settings ─────────────────────────────────────────────────────────────── */

export function getSetting(key: string): string | null {
  return tables.settings[key] ?? null;
}

export function setSetting(key: string, value: string): void {
  tables.settings[key] = value;
  save();
}

export const DEFAULT_CAPTURE_DAYS = 7;

export function getCaptureDaysGlobal(): number {
  const n = Number(getSetting('capture_days_global'));
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_CAPTURE_DAYS;
}

export function setCaptureDaysGlobal(days: number): void {
  setSetting('capture_days_global', String(Math.max(1, Math.round(days))));
}

export const DEFAULT_ALERT: AlertRule = {
  pct: 20,
  price: null,
  ccy: 'ILS',
  anyDrop: true,
  scope: 'any',
};

/** '' means "rule off"; absent means "never configured, use the default". */
function numberSetting(key: string, fallback: number | null): number | null {
  const raw = getSetting(key);
  if (raw === null) return fallback;
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function getAlertDefaults(): AlertRule {
  const ccy = getSetting('alert_price_ccy_global');
  const scope = getSetting('alert_scope_global');
  const anyDrop = getSetting('alert_any_drop');
  return {
    pct: numberSetting('alert_pct_global', DEFAULT_ALERT.pct),
    price: numberSetting('alert_price_global', DEFAULT_ALERT.price),
    ccy: ccy && ['ILS', 'USD', 'EUR'].includes(ccy) ? ccy : DEFAULT_ALERT.ccy,
    anyDrop: anyDrop === null ? DEFAULT_ALERT.anyDrop : anyDrop === '1',
    scope: isAlertScope(scope) ? scope : DEFAULT_ALERT.scope,
  };
}

export function setAlertDefaults(patchRule: Partial<AlertRule>): void {
  if ('pct' in patchRule) {
    setSetting('alert_pct_global', patchRule.pct == null ? '' : String(Math.round(patchRule.pct)));
  }
  if ('price' in patchRule) {
    setSetting('alert_price_global', patchRule.price == null ? '' : String(patchRule.price));
  }
  if (patchRule.ccy && ['ILS', 'USD', 'EUR'].includes(patchRule.ccy)) {
    setSetting('alert_price_ccy_global', patchRule.ccy);
  }
  if ('anyDrop' in patchRule) setSetting('alert_any_drop', patchRule.anyDrop ? '1' : '0');
  if (patchRule.scope && isAlertScope(patchRule.scope)) setSetting('alert_scope_global', patchRule.scope);
}

export type DisplayCurrency = 'ILS' | 'USD' | 'EUR';
const DISPLAY_CURRENCIES: readonly string[] = ['ILS', 'USD', 'EUR'];

export function getDisplayCurrency(): DisplayCurrency {
  const v = getSetting('display_currency');
  return v && DISPLAY_CURRENCIES.includes(v) ? (v as DisplayCurrency) : 'ILS';
}

export function setDisplayCurrency(c: string): void {
  if (DISPLAY_CURRENCIES.includes(c)) setSetting('display_currency', c);
}

/* ── Price history ────────────────────────────────────────────────────────── */

const point = (h: HistoryRow): HistoryPoint => ({
  store: h.store,
  region: h.region,
  kind: h.kind,
  price: h.price,
  currency: h.currency,
  price_ils: h.price_ils,
  checked_at: h.checked_at,
});

export function recordOffers(wishlistId: number, offers: OfferPoint[], checkedAt?: string): void {
  if (offers.length === 0) return;
  let at = checkedAt ?? now();
  if (!checkedAt) {
    // checked_at is second-precision, so two captures inside the same second
    // would silently MERGE into one "check" — mixing old and new prices under a
    // single timestamp and corrupting every cheapest-per-check series.
    const last = lastCheckedAt(wishlistId);
    if (last && at <= last) {
      at = new Date(Date.parse(last.replace(' ', 'T') + 'Z') + 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
    }
  }
  for (const o of offers) {
    tables.history.push({
      id: tables.nextId.history++,
      wishlist_id: wishlistId,
      store: o.store,
      region: o.region ?? null,
      kind: o.kind ?? null,
      price: o.price,
      currency: o.currency,
      price_ils: o.priceILS,
      checked_at: at,
    });
  }
  save();
}

/**
 * Cheapest offer per check, matching the SQL this replaces: group the game's
 * rows by timestamp, keep the cheapest of each group, newest first.
 */
function bestPerCheckWhere(
  wishlistId: number,
  keep: (h: HistoryRow) => boolean,
  limit = 400
): HistoryPoint[] {
  const groups = new Map<string, HistoryRow>();
  for (const h of tables.history) {
    if (h.wishlist_id !== wishlistId || !keep(h)) continue;
    const best = groups.get(h.checked_at);
    // Strictly cheaper only, so a tie keeps the first row seen — the same one
    // SQLite's bare-column GROUP BY returns.
    if (!best || h.price_ils < best.price_ils) groups.set(h.checked_at, h);
  }
  return [...groups.values()]
    .sort((a, b) => (a.checked_at < b.checked_at ? 1 : a.checked_at > b.checked_at ? -1 : 0))
    .slice(0, limit)
    .map(point);
}

export function bestPerCheck(wishlistId: number, limit = 400): HistoryPoint[] {
  return bestPerCheckWhere(wishlistId, () => true, limit);
}

export function bestPerCheckInRegion(wishlistId: number, region: string, limit = 400): HistoryPoint[] {
  return bestPerCheckWhere(wishlistId, (h) => h.region === region, limit);
}

export function bestPerCheckForScope(
  wishlistId: number,
  scope: AlertScope,
  preferredRegion: string | null
): HistoryPoint[] {
  const regional = preferredRegion ? bestPerCheckInRegion(wishlistId, preferredRegion) : [];
  switch (scope) {
    case 'official':
      // In-platform digital carries a region; key sellers and discs don't.
      return regional.length > 0 ? regional : bestPerCheckWhere(wishlistId, (h) => h.region !== null);
    case 'physical':
      return bestPerCheckWhere(wishlistId, (h) => h.kind === 'physical');
    case 'cdkey':
      return bestPerCheckWhere(wishlistId, (h) => h.kind === 'digital' && h.region === null);
    case 'any':
      return bestPerCheck(wishlistId);
    default:
      return regional.length > 0 ? regional : bestPerCheck(wishlistId);
  }
}

export function latestCheapestOf(wishlistId: number, bucket: 'physical' | 'external'): HistoryPoint | null {
  const keep = (h: HistoryRow) =>
    bucket === 'physical' ? h.kind === 'physical' : h.kind === 'digital' && h.region === null;
  const rows = tables.history.filter((h) => h.wishlist_id === wishlistId && keep(h));
  if (rows.length === 0) return null;
  const at = rows.reduce((max, h) => (h.checked_at > max ? h.checked_at : max), rows[0].checked_at);
  const atLast = rows.filter((h) => h.checked_at === at).sort((a, b) => a.price_ils - b.price_ils);
  return atLast[0] ? point(atLast[0]) : null;
}

export function lastCheckedAt(wishlistId: number): string | null {
  let at: string | null = null;
  for (const h of tables.history) {
    if (h.wishlist_id === wishlistId && (at === null || h.checked_at > at)) at = h.checked_at;
  }
  return at;
}

export function lastCheckSnapshot(
  wishlistId: number
): { at: string; rows: { store: string; region: string | null; kind: string | null; price_ils: number }[] } | null {
  const at = lastCheckedAt(wishlistId);
  if (!at) return null;
  const rows = tables.history
    .filter((h) => h.wishlist_id === wishlistId && h.checked_at === at)
    .map((h) => ({ store: h.store, region: h.region, kind: h.kind, price_ils: h.price_ils }));
  return { at, rows };
}

/** Oldest→newest, matching `ORDER BY checked_at ASC, id ASC`. */
function chronological(wishlistId: number): HistoryRow[] {
  return tables.history
    .filter((h) => h.wishlist_id === wishlistId)
    .sort((a, b) => (a.checked_at < b.checked_at ? -1 : a.checked_at > b.checked_at ? 1 : a.id - b.id));
}

export function fullOfferHistory(wishlistId: number): HistoryPoint[] {
  return chronological(wishlistId).map(point);
}

/* ── Import / export ──────────────────────────────────────────────────────── */

export interface ExportItem {
  title: string;
  platform: string;
  image: string | null;
  refs: SourceRef[];
  preferred_region?: string | null;
  hide_desc?: number;
  added_at: string;
  history: {
    store: string;
    region?: string | null;
    kind?: string | null;
    price: number;
    currency: string;
    price_ils: number;
    checked_at: string;
  }[];
}

export function exportAll(): ExportItem[] {
  return listWishlist().map((row) => ({
    title: row.title,
    platform: row.platform,
    image: row.image,
    refs: JSON.parse(row.refs) as SourceRef[],
    preferred_region: row.preferred_region,
    hide_desc: row.hide_desc,
    added_at: row.added_at,
    history: chronological(row.id).map(point),
  }));
}

export function importAll(raw: unknown): { games: number; points: number } {
  const items = sanitizeImport(raw);
  let games = 0;
  let points = 0;
  for (const item of items) {
    // An item the sanitiser stripped to nothing would become a row that can
    // never be priced and never charted, only re-scraped forever.
    if (item.refs.length === 0 && item.history.length === 0) continue;

    const before = findWishlist(item.title, item.platform);
    const row = addToWishlist({
      title: item.title,
      platform: item.platform,
      image: item.image ?? undefined,
      refs: item.refs,
    });
    if (!before) {
      games++;
      // New to us: adopt the sharer's per-game settings and original add date.
      if (item.preferred_region !== null) setPreferredRegion(row.id, item.preferred_region);
      if (item.hide_desc) setHideDesc(row.id, true);
      if (item.added_at) patch(row.id, (r) => (r.added_at = item.added_at));
    }
    // Already tracked locally: leave the local user's own settings alone.

    const existing = new Set(
      tables.history
        .filter((h) => h.wishlist_id === row.id)
        .map((h) => `${h.checked_at}|${h.store}|${h.region ?? ''}`)
    );
    for (const h of item.history) {
      const key = `${h.checked_at}|${h.store}|${h.region ?? ''}`;
      if (existing.has(key)) continue;
      tables.history.push({
        id: tables.nextId.history++,
        wishlist_id: row.id,
        store: h.store,
        region: h.region ?? null,
        kind: h.kind ?? null,
        price: h.price,
        currency: h.currency,
        price_ils: h.price_ils,
        checked_at: h.checked_at,
      });
      existing.add(key);
      points++;
    }
  }
  save();
  return { games, points };
}

/** Test seam: load a known state without IndexedDB. */
export function __setTables(next: Partial<Tables>): void {
  tables = { ...empty(), ...next };
  loading = Promise.resolve();
}
