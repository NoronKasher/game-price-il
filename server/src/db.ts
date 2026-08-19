import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { sanitizeImport } from './importGuard.ts';
import { isAlertScope, type AlertMode, type AlertRule, type AlertScope } from './alerts.ts';

/**
 * Local-first storage using Node's built-in SQLite (no native deps).
 * The DB file lives next to the project so price history survives restarts
 * and belongs to the user.
 *
 * Schema v2: a wishlist row is a game+platform and carries `refs` — a JSON
 * array of {sourceId, sourceGameId} — so one tracked game is re-checked
 * across every source (digital stores, VGS, Player1...) and the history
 * records the best price found each time.
 */

// Normally the project's own data/ directory, so price history belongs to the
// user and survives restarts. VGPT_DATA_DIR points a throwaway copy somewhere
// else, which is how the migration/repair paths are tested without risking it.
const dataDir = process.env.VGPT_DATA_DIR
  ? path.resolve(process.env.VGPT_DATA_DIR)
  : path.join(import.meta.dirname, '..', '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'games.db'));

// ON DELETE CASCADE on price_history/notifications only fires when foreign keys
// are enforced. node:sqlite happens to default this on, but the schema's
// correctness must not depend on a driver default — state it explicitly.
db.exec('PRAGMA foreign_keys = ON');

/**
 * Is this a brand-new database? Must be answered BEFORE the baseline runs: the
 * baseline creates every table at the CURRENT shape, so a fresh file is already
 * fully up to date and no migration step may run against it (replaying
 * `ALTER TABLE … ADD COLUMN` over the baseline throws "duplicate column name"
 * and takes the whole server down on first launch).
 */
const isFreshDatabase =
  db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wishlist'`).get() ===
  undefined;

// --- Baseline schema. A brand-new database gets the current schema directly;
//     an existing one is brought up to it by the additive migrations below.
//     Every statement here is idempotent (IF NOT EXISTS) and NON-destructive. ---
db.exec(`
  CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    platform TEXT NOT NULL,
    image TEXT,
    refs TEXT NOT NULL DEFAULT '[]',
    preferred_region TEXT,
    hide_desc INTEGER NOT NULL DEFAULT 0,
    capture_days INTEGER,            -- per-game auto-capture interval; NULL = use global
    alert_mode TEXT,                 -- NULL/'global' = follow the global rule, 'custom', 'off'
    alert_pct INTEGER,               -- custom: notify when discounted ≥ this % off its normal price
    alert_price REAL,                -- custom: notify when the watched price falls to/below this…
    alert_price_ccy TEXT,            -- …in this currency (ILS/USD/EUR)
    alert_scope TEXT,                -- WHICH price to watch; NULL = the global default
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (title, platform)
  );

  -- One row per offer per check (region/kind kept so any series can be plotted).
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wishlist_id INTEGER NOT NULL REFERENCES wishlist(id) ON DELETE CASCADE,
    store TEXT NOT NULL,
    region TEXT,
    kind TEXT,
    price REAL NOT NULL,
    currency TEXT NOT NULL,
    price_ils REAL NOT NULL,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_history_wishlist
    ON price_history (wishlist_id, checked_at);

  -- Global key/value app settings (capture interval, default currency, API keys).
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Sale alerts that fired for a tracked game — the in-app notification bell list.
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wishlist_id INTEGER REFERENCES wishlist(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    price_ils REAL,
    kind TEXT,                       -- why it fired: 'drop' | 'pct' | 'price'
    platform TEXT,                   -- the tracked game's platform (same title, two consoles)
    scope TEXT,                      -- which price it was: official / physical / cdkey / any
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/**
 * Schema version + ADDITIVE migrations.
 *
 * The previous code DROPped every table on a version bump — which would erase a
 * user's entire price history the moment the schema changed. For a tool whose
 * whole value is data accumulated over time, that's unacceptable. Upgrades now
 * only ever ADD; existing data is always preserved.
 *
 * To evolve the schema: bump SCHEMA_VERSION and add a MIGRATIONS[newVersion]
 * entry of additive SQL (e.g. `ALTER TABLE wishlist ADD COLUMN notes TEXT`).
 * Also update the baseline CREATE above so fresh installs get the new shape.
 * Each step runs exactly once, in order.
 */
const SCHEMA_VERSION = 6;
const MIGRATIONS: Record<number, string[]> = {
  4: [
    'ALTER TABLE wishlist ADD COLUMN capture_days INTEGER',
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  ],
  5: [
    'ALTER TABLE wishlist ADD COLUMN alert_pct INTEGER',
    'ALTER TABLE wishlist ADD COLUMN alert_price REAL',
    'ALTER TABLE wishlist ADD COLUMN alert_price_ccy TEXT',
    `CREATE TABLE IF NOT EXISTS notifications (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       wishlist_id INTEGER REFERENCES wishlist(id) ON DELETE CASCADE,
       title TEXT NOT NULL, message TEXT NOT NULL, price_ils REAL, kind TEXT,
       read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ],
  6: [
    // Alerts became global-by-default: every tracked game is watched with the
    // global rule unless its own mode says otherwise, and `alert_scope` says
    // WHICH of its prices to watch (official store / disc / key seller).
    'ALTER TABLE wishlist ADD COLUMN alert_mode TEXT',
    'ALTER TABLE wishlist ADD COLUMN alert_scope TEXT',
    'ALTER TABLE notifications ADD COLUMN platform TEXT',
    'ALTER TABLE notifications ADD COLUMN scope TEXT',
    // Games that already had a hand-set rule keep behaving exactly as before.
    `UPDATE wishlist SET alert_mode = 'custom'
       WHERE alert_mode IS NULL AND (alert_pct IS NOT NULL OR alert_price IS NOT NULL)`,
  ],
};

/**
 * Run one migration statement, tolerating the case where the baseline CREATE
 * above already produced what it adds. A fresh database is short-circuited in
 * `migrate()`, so this only matters if a future baseline/migration pair overlaps
 * — better a no-op than a server that won't boot.
 */
function runMigrationStep(sql: string): void {
  try {
    db.exec(sql);
  } catch (err) {
    if (/duplicate column name/i.test((err as Error).message)) return;
    throw err;
  }
}

/**
 * Every column the current code expects, with the declaration to add it with.
 * The version counter alone is not a safe contract: it can be stamped forward
 * without its statements running (a restart that catches a half-saved migration,
 * a restored backup, a rolled-back branch), and the result is a database that
 * *claims* to be current while missing columns — every query against them then
 * throws and the tool is dead until someone hand-repairs the file.
 *
 * So after migrating we reconcile: whatever route this file took, any missing
 * column is added. Table/column names come from this map (never user input), and
 * adding a column is additive — no data is touched.
 */
const EXPECTED_COLUMNS: Record<string, Record<string, string>> = {
  wishlist: {
    preferred_region: 'TEXT',
    hide_desc: 'INTEGER NOT NULL DEFAULT 0',
    capture_days: 'INTEGER',
    alert_mode: 'TEXT',
    alert_pct: 'INTEGER',
    alert_price: 'REAL',
    alert_price_ccy: 'TEXT',
    alert_scope: 'TEXT',
  },
  notifications: { platform: 'TEXT', scope: 'TEXT' },
};

/** Add any expected column this database is missing. Returns the ones it added. */
function reconcileColumns(): string[] {
  const added: string[] = [];
  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    const present = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map(
        (c) => c.name
      )
    );
    for (const [column, decl] of Object.entries(columns)) {
      if (present.has(column)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
      added.push(`${table}.${column}`);
    }
  }
  return added;
}

function migrate(): void {
  // A brand-new file already has the current schema from the baseline — stamp it
  // and run nothing, or the additive ALTERs would collide with those columns.
  if (isFreshDatabase) {
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return;
  }
  const readVersion = () =>
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  let v = readVersion();
  // Databases below 3 only ever held throwaway pre-release data, and the
  // baseline above already gives them the current schema — stamp them to 3
  // without touching any rows. From 3 on, upgrade one additive step at a time.
  if (v < 3) {
    db.exec('PRAGMA user_version = 3');
    v = 3;
  }
  while (v < SCHEMA_VERSION) {
    for (const sql of MIGRATIONS[v + 1] ?? []) runMigrationStep(sql);
    v += 1;
    db.exec(`PRAGMA user_version = ${v}`);
  }
}
migrate();

const repaired = reconcileColumns();
if (repaired.length > 0) {
  console.warn(`schema repair: added missing column(s) ${repaired.join(', ')}`);
  // A database that was missing `alert_mode` predates per-game alert modes, so
  // any game that already carries a hand-set threshold keeps behaving as before
  // (its own rule) instead of silently switching to the new global one.
  if (repaired.includes('wishlist.alert_mode')) {
    db.exec(
      `UPDATE wishlist SET alert_mode = 'custom'
       WHERE alert_mode IS NULL AND (alert_pct IS NOT NULL OR alert_price IS NOT NULL)`
    );
  }
}

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

export function addToWishlist(item: {
  title: string;
  platform: string;
  image?: string;
  refs: SourceRef[];
}): WishlistRow {
  const existing = db
    .prepare(`SELECT * FROM wishlist WHERE title = ? AND platform = ?`)
    .get(item.title, item.platform) as unknown as WishlistRow | undefined;

  if (existing) {
    // Merge refs so re-adding after new sources appear enriches the row.
    const merged = [...(JSON.parse(existing.refs) as SourceRef[])];
    for (const ref of item.refs) {
      if (!merged.some((r) => r.sourceId === ref.sourceId && r.sourceGameId === ref.sourceGameId)) {
        merged.push(ref);
      }
    }
    db.prepare(`UPDATE wishlist SET refs = ?, image = COALESCE(image, ?) WHERE id = ?`).run(
      JSON.stringify(merged),
      item.image ?? null,
      existing.id
    );
    return { ...existing, refs: JSON.stringify(merged) };
  }

  db.prepare(`INSERT INTO wishlist (title, platform, image, refs) VALUES (?, ?, ?, ?)`).run(
    item.title,
    item.platform,
    item.image ?? null,
    JSON.stringify(item.refs)
  );
  return db
    .prepare(`SELECT * FROM wishlist WHERE title = ? AND platform = ?`)
    .get(item.title, item.platform) as unknown as WishlistRow;
}

export function removeFromWishlist(id: number): void {
  db.prepare(`DELETE FROM price_history WHERE wishlist_id = ?`).run(id);
  db.prepare(`DELETE FROM wishlist WHERE id = ?`).run(id);
}

export function listWishlist(): WishlistRow[] {
  return db.prepare(`SELECT * FROM wishlist ORDER BY added_at DESC`).all() as unknown as WishlistRow[];
}

/** Per-game preferred region (digital only) — the series the graph focuses on. */
export function setPreferredRegion(id: number, region: string | null): void {
  db.prepare(`UPDATE wishlist SET preferred_region = ? WHERE id = ?`).run(region, id);
}

export function setHideDesc(id: number, hide: boolean): void {
  db.prepare(`UPDATE wishlist SET hide_desc = ? WHERE id = ?`).run(hide ? 1 : 0, id);
}

/** Per-game auto-capture interval in days; null clears the override (use the global). */
export function setCaptureDays(id: number, days: number | null): void {
  db.prepare(`UPDATE wishlist SET capture_days = ? WHERE id = ?`).run(days, id);
}

/**
 * Per-game sale-alert override: notify at ≥pct% off, and/or at/below `price` in
 * `ccy`. Nulls clear. Setting a threshold implies 'custom' mode — otherwise the
 * number would sit in the row doing nothing while the global rule ran instead.
 */
export function setAlert(
  id: number,
  a: { pct?: number | null; price?: number | null; ccy?: string | null }
): void {
  if ('pct' in a) db.prepare(`UPDATE wishlist SET alert_pct = ? WHERE id = ?`).run(a.pct ?? null, id);
  if ('price' in a) {
    db.prepare(`UPDATE wishlist SET alert_price = ?, alert_price_ccy = ? WHERE id = ?`).run(
      a.price ?? null,
      a.price != null ? (a.ccy ?? 'ILS') : null,
      id
    );
  }
  if (a.pct != null || a.price != null) setAlertMode(id, 'custom');
}

/** Per-game alert mode: follow the global rule, use this game's own, or stay silent. */
export function setAlertMode(id: number, mode: AlertMode): void {
  db.prepare(`UPDATE wishlist SET alert_mode = ? WHERE id = ?`).run(mode, id);
}

/** Per-game watched price (official store / disc / key seller); null = global default. */
export function setAlertScope(id: number, scope: AlertScope | null): void {
  db.prepare(`UPDATE wishlist SET alert_scope = ? WHERE id = ?`).run(scope, id);
}

/* ── Notifications (in-app sale-alert bell) ───────────────────────────────── */

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

/** Keep the notifications log bounded so it can't grow without limit over time. */
const MAX_NOTIFICATIONS = 200;

export function addNotification(n: {
  wishlistId: number;
  title: string;
  message: string;
  priceILS: number;
  kind: string;
  platform?: string | null;
  scope?: string | null;
}): void {
  db.prepare(
    `INSERT INTO notifications (wishlist_id, title, message, price_ils, kind, platform, scope)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(n.wishlistId, n.title, n.message, n.priceILS, n.kind, n.platform ?? null, n.scope ?? null);
  // Prune anything past the newest MAX_NOTIFICATIONS.
  db.prepare(
    `DELETE FROM notifications WHERE id NOT IN (
       SELECT id FROM notifications ORDER BY created_at DESC, id DESC LIMIT ?
     )`
  ).run(MAX_NOTIFICATIONS);
}

export function listNotifications(limit = 50): NotificationRow[] {
  return db
    .prepare(`SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(limit) as unknown as NotificationRow[];
}

export function unreadNotificationCount(): number {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE read = 0`).get() as { n: number };
  return r.n;
}

export function markNotificationsRead(): void {
  db.prepare(`UPDATE notifications SET read = 1 WHERE read = 0`).run();
}

export function clearNotifications(): void {
  db.prepare(`DELETE FROM notifications`).run();
}

/* ── Global key/value settings ────────────────────────────────────────────── */

export function getSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

/** Global default auto-capture interval in days (how often a new point is recorded). */
export const DEFAULT_CAPTURE_DAYS = 7;
export function getCaptureDaysGlobal(): number {
  const n = Number(getSetting('capture_days_global'));
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_CAPTURE_DAYS;
}
export function setCaptureDaysGlobal(days: number): void {
  setSetting('capture_days_global', String(Math.max(1, Math.round(days))));
}

/**
 * The GLOBAL sale-alert rule — the one that watches every tracked game unless the
 * game overrides it. Alerts are on out of the box: a tool whose point is catching
 * price drops shouldn't need per-game setup before it says anything. Defaults are
 * deliberately mild — any real drop is reported, and 20% off is the "worth a look"
 * line — and every part of it is editable from the bell or the tracking list.
 */
export const DEFAULT_ALERT: AlertRule = {
  pct: 20,
  price: null,
  ccy: 'ILS',
  anyDrop: true,
  // Watch the cheapest offer of ANY kind by default, not just the headline price:
  // 'auto' followed only the pinned region's store, so a big drop in a game's
  // keyshop or disc price (a real deal the user would want) fired nothing. A game
  // the user tracks for one specific price can still narrow this per-game.
  scope: 'any',
};

/** Read a stored number setting; '' means "rule off", absent means "use the default". */
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

export function setAlertDefaults(patch: Partial<AlertRule>): void {
  // A null threshold is a deliberate "off", stored as '' so it isn't mistaken for
  // "never configured" (which would resurrect the built-in default).
  if ('pct' in patch) setSetting('alert_pct_global', patch.pct == null ? '' : String(Math.round(patch.pct)));
  if ('price' in patch) setSetting('alert_price_global', patch.price == null ? '' : String(patch.price));
  if (patch.ccy && ['ILS', 'USD', 'EUR'].includes(patch.ccy)) setSetting('alert_price_ccy_global', patch.ccy);
  if ('anyDrop' in patch) setSetting('alert_any_drop', patch.anyDrop ? '1' : '0');
  if (patch.scope && isAlertScope(patch.scope)) setSetting('alert_scope_global', patch.scope);
}

/** The currency every displayed price is shown in (prices are stored in ILS). */
export type DisplayCurrency = 'ILS' | 'USD' | 'EUR';
const DISPLAY_CURRENCIES: readonly string[] = ['ILS', 'USD', 'EUR'];
export function getDisplayCurrency(): DisplayCurrency {
  const v = getSetting('display_currency');
  return v && DISPLAY_CURRENCIES.includes(v) ? (v as DisplayCurrency) : 'ILS';
}
export function setDisplayCurrency(c: string): void {
  if (DISPLAY_CURRENCIES.includes(c)) setSetting('display_currency', c);
}

export interface OfferPoint {
  store: string;
  region?: string | null;
  kind?: string | null;
  price: number;
  currency: string;
  priceILS: number;
}

/** Record ALL offers from one check under a single timestamp (not just the cheapest). */
export function recordOffers(wishlistId: number, offers: OfferPoint[], checkedAt?: string): void {
  if (offers.length === 0) return;
  let at = checkedAt ?? new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (!checkedAt) {
    // checked_at is second-precision, so two captures inside the same second
    // would silently MERGE into one "check" — mixing old and new prices under a
    // single timestamp and corrupting every cheapest-per-check series. Nudge
    // past the last recorded check instead. (Explicit timestamps — imports,
    // tests — are the caller's responsibility and left untouched.)
    const last = lastCheckedAt(wishlistId);
    if (last && at <= last) {
      at = new Date(Date.parse(last.replace(' ', 'T') + 'Z') + 1000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);
    }
  }
  const stmt = db.prepare(
    `INSERT INTO price_history (wishlist_id, store, region, kind, price, currency, price_ils, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const o of offers) {
    stmt.run(wishlistId, o.store, o.region ?? null, o.kind ?? null, o.price, o.currency, o.priceILS, at);
  }
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

/**
 * Cheapest offer per check, newest first, among the offers matching `cond` — the
 * shape every "price over time" line shares. `cond` is applied twice (once to pick
 * the rows, once inside the per-check MIN), so its parameters are bound twice.
 */
function bestPerCheckWhere(
  wishlistId: number,
  cond: string,
  params: (string | number)[] = [],
  limit = 400
): HistoryPoint[] {
  return db
    .prepare(
      `SELECT store, region, kind, price, currency, price_ils, checked_at
       FROM price_history ph
       WHERE wishlist_id = ? AND ${cond} AND price_ils = (
         SELECT MIN(price_ils) FROM price_history
         WHERE wishlist_id = ph.wishlist_id AND checked_at = ph.checked_at AND ${cond}
       )
       GROUP BY checked_at
       ORDER BY checked_at DESC LIMIT ?`
    )
    .all(wishlistId, ...params, ...params, limit) as unknown as HistoryPoint[];
}

/** Cheapest offer per check, newest first — powers the wishlist summary + default graph line. */
export function bestPerCheck(wishlistId: number, limit = 400): HistoryPoint[] {
  return bestPerCheckWhere(wishlistId, '1 = 1', [], limit);
}

/**
 * Cheapest offer per check WITHIN one region — the region-pinned summary line.
 * When the user picks a region to track, the wishlist "best price" should follow
 * that region's (digital) price, not the global cheapest. Physical/local offers
 * carry no region, so they're naturally excluded (preferred region is digital).
 */
export function bestPerCheckInRegion(wishlistId: number, region: string, limit = 400): HistoryPoint[] {
  return bestPerCheckWhere(wishlistId, 'region = ?', [region], limit);
}

/**
 * The price series a sale alert watches, per its scope — so a game tracked for
 * its disc price is judged on disc prices, and one tracked for the PSN US store
 * on that store. Region-scoped series fall back when the game isn't sold there,
 * so pinning a region can never silence a game's alerts entirely.
 */
export function bestPerCheckForScope(
  wishlistId: number,
  scope: AlertScope,
  preferredRegion: string | null
): HistoryPoint[] {
  const regional = preferredRegion ? bestPerCheckInRegion(wishlistId, preferredRegion) : [];
  switch (scope) {
    case 'official':
      // In-platform digital carries a region; key sellers and discs don't.
      return regional.length > 0 ? regional : bestPerCheckWhere(wishlistId, 'region IS NOT NULL');
    case 'physical':
      return bestPerCheckWhere(wishlistId, `kind = 'physical'`);
    case 'cdkey':
      return bestPerCheckWhere(wishlistId, `kind = 'digital' AND region IS NULL`);
    case 'any':
      return bestPerCheck(wishlistId);
    default:
      // 'auto' — exactly the headline price the tracking list shows for this game.
      return regional.length > 0 ? regional : bestPerCheck(wishlistId);
  }
}

/**
 * Cheapest offer of one "bucket" from the most recent check that recorded it —
 * for the tracking-list summary that shows disc / keyshop / in-platform side by
 * side. `bucket`:
 *   - 'physical'  → cheapest disc (kind = physical)
 *   - 'external'  → cheapest keyshop / reseller (digital with no region — the
 *                    CD-key & external-store bucket; in-platform digital always
 *                    carries a region)
 */
export function latestCheapestOf(wishlistId: number, bucket: 'physical' | 'external'): HistoryPoint | null {
  const cond = bucket === 'physical' ? `kind = 'physical'` : `kind = 'digital' AND region IS NULL`;
  return (db
    .prepare(
      `SELECT store, region, kind, price, currency, price_ils, checked_at
       FROM price_history
       WHERE wishlist_id = ? AND ${cond}
         AND checked_at = (
           SELECT MAX(checked_at) FROM price_history WHERE wishlist_id = ? AND ${cond}
         )
       ORDER BY price_ils ASC LIMIT 1`
    )
    .get(wishlistId, wishlistId) ?? null) as HistoryPoint | null;
}

/** Timestamp of the most recent recorded check for a game (any offer), or null. */
export function lastCheckedAt(wishlistId: number): string | null {
  const row = db
    .prepare(`SELECT MAX(checked_at) AS at FROM price_history WHERE wishlist_id = ?`)
    .get(wishlistId) as { at: string | null } | undefined;
  return row?.at ?? null;
}

/**
 * Every offer recorded at the most recent check — the snapshot a fresh scrape is
 * compared against to decide whether anything actually changed (capture.ts).
 */
export function lastCheckSnapshot(
  wishlistId: number
): { at: string; rows: { store: string; region: string | null; kind: string | null; price_ils: number }[] } | null {
  const at = lastCheckedAt(wishlistId);
  if (!at) return null;
  const rows = db
    .prepare(
      `SELECT store, region, kind, price_ils FROM price_history
       WHERE wishlist_id = ? AND checked_at = ?`
    )
    .all(wishlistId, at) as unknown as {
    store: string;
    region: string | null;
    kind: string | null;
    price_ils: number;
  }[];
  return { at, rows };
}

/** Every recorded offer point, oldest→newest — for multi-series graphs. */
export function fullOfferHistory(wishlistId: number): HistoryPoint[] {
  return db
    .prepare(
      `SELECT store, region, kind, price, currency, price_ils, checked_at
       FROM price_history WHERE wishlist_id = ? ORDER BY checked_at ASC, id ASC`
    )
    .all(wishlistId) as unknown as HistoryPoint[];
}

/** One tracked game by id — the row the per-game endpoints operate on. */
export function getWishlistRow(id: number): WishlistRow | undefined {
  if (!Number.isFinite(id)) return undefined;
  return db.prepare(`SELECT * FROM wishlist WHERE id = ?`).get(id) as unknown as
    | WishlistRow
    | undefined;
}

/** Find a tracked game by its exact title + platform (for the game page). */
export function findWishlist(title: string, platform: string): WishlistRow | undefined {
  return db
    .prepare(`SELECT * FROM wishlist WHERE title = ? AND platform = ?`)
    .get(title, platform) as unknown as WishlistRow | undefined;
}

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

/** Everything the user tracks + full history — a shareable, re-importable file. */
export function exportAll(): ExportItem[] {
  return listWishlist().map((row) => ({
    title: row.title,
    platform: row.platform,
    image: row.image,
    refs: JSON.parse(row.refs) as SourceRef[],
    preferred_region: row.preferred_region,
    hide_desc: row.hide_desc,
    added_at: row.added_at,
    history: db
      .prepare(
        `SELECT store, region, kind, price, currency, price_ils, checked_at FROM price_history
         WHERE wishlist_id = ? ORDER BY checked_at ASC, id ASC`
      )
      .all(row.id) as unknown as ExportItem['history'],
  }));
}

/**
 * Merge a shared tracking file in — additive and non-destructive, so two people
 * can swap files both ways without either losing anything:
 *   - untrusted input is sanitised first (importGuard.ts): caps, allowlists, no
 *     unsafe URLs;
 *   - games unify by (title, platform); refs are unioned;
 *   - price history is unioned, de-duped by (checked_at, store, region), so every
 *     data point from both people survives;
 *   - a brand-new game adopts the sharer's settings + original add date, but an
 *     existing game KEEPS the local user's own preferred region / hide-desc — a
 *     friend's file never overwrites your choices.
 * `raw` is whatever the request body held (an array or `{ items: [...] }`).
 */
export function importAll(raw: unknown): { games: number; points: number } {
  const items = sanitizeImport(raw);
  let games = 0;
  let points = 0;
  const insertPoint = db.prepare(
    `INSERT INTO price_history (wishlist_id, store, region, kind, price, currency, price_ils, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const item of items) {
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
      if (item.added_at) db.prepare(`UPDATE wishlist SET added_at = ? WHERE id = ?`).run(item.added_at, row.id);
    }
    // Already tracked locally: leave preferred_region / hide_desc / added_at as
    // they are — merging must not erase the local user's own settings.

    // De-dupe history by (checked_at, store, region) so re-imports don't pile up.
    const existing = new Set(
      (db
        .prepare(`SELECT checked_at, store, region FROM price_history WHERE wishlist_id = ?`)
        .all(row.id) as unknown as { checked_at: string; store: string; region: string | null }[]).map(
        (h) => `${h.checked_at}|${h.store}|${h.region ?? ''}`
      )
    );
    for (const h of item.history) {
      const key = `${h.checked_at}|${h.store}|${h.region ?? ''}`;
      if (existing.has(key)) continue;
      insertPoint.run(row.id, h.store, h.region, h.kind, h.price, h.currency, h.price_ils, h.checked_at);
      existing.add(key);
      points++;
    }
  }
  return { games, points };
}
