import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Storage tests. The whole point of this tool is data accumulated over months,
 * so the paths that could destroy or brick it — opening a fresh file, upgrading
 * an old one, and recovering from a version stamp that lies — are worth pinning
 * down. Each test loads db.ts against its own throwaway data directory
 * (VGPT_DATA_DIR) with a cache-busting import so the module re-runs its
 * migration from scratch.
 */

let n = 0;
function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgpt-db-'));
  return dir;
}

async function loadDb(dir) {
  process.env.VGPT_DATA_DIR = dir;
  return import(`./db.ts?case=${n++}`);
}

const columns = (db, table) =>
  new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));

test('a brand-new database opens at the current version, ready to use', async () => {
  const dir = tempDataDir();
  const db = await loadDb(dir);
  const row = db.addToWishlist({ title: 'Elden Ring', platform: 'ps5', refs: [] });
  assert.ok(row.id > 0);
  // The alert columns the current code depends on must exist from the start.
  const cols = columns(db.db, 'wishlist');
  for (const c of ['alert_mode', 'alert_scope', 'alert_pct', 'capture_days']) assert.ok(cols.has(c), c);
  assert.deepEqual(db.getAlertDefaults(), db.DEFAULT_ALERT);
});

test('an older database keeps every row while gaining the new columns', async () => {
  const dir = tempDataDir();
  // A v5-era file: no alert_mode/alert_scope, one tracked game with its own rule.
  const seed = new DatabaseSync(path.join(dir, 'games.db'));
  seed.exec(`
    CREATE TABLE wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, platform TEXT NOT NULL,
      image TEXT, refs TEXT NOT NULL DEFAULT '[]', preferred_region TEXT,
      hide_desc INTEGER NOT NULL DEFAULT 0, capture_days INTEGER, alert_pct INTEGER,
      alert_price REAL, alert_price_ccy TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (title, platform));
    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wishlist_id INTEGER NOT NULL REFERENCES wishlist(id) ON DELETE CASCADE,
      store TEXT NOT NULL, region TEXT, kind TEXT, price REAL NOT NULL, currency TEXT NOT NULL,
      price_ils REAL NOT NULL, checked_at TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, wishlist_id INTEGER REFERENCES wishlist(id) ON DELETE CASCADE,
      title TEXT NOT NULL, message TEXT NOT NULL, price_ils REAL, kind TEXT,
      read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO wishlist (title, platform, alert_pct) VALUES ('God of War', 'ps5', 40);
    INSERT INTO price_history (wishlist_id, store, kind, price, currency, price_ils, checked_at)
      VALUES (1, 'VGS', 'physical', 199, 'ILS', 199, '2026-01-01 10:00:00');
    PRAGMA user_version = 5;
  `);
  seed.close();

  const db = await loadDb(dir);
  const rows = db.listWishlist();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'God of War');
  assert.equal(db.bestPerCheck(rows[0].id).length, 1, 'price history survived the upgrade');
  assert.ok(columns(db.db, 'wishlist').has('alert_scope'));
  assert.ok(columns(db.db, 'notifications').has('platform'));
  // A game that already had its own threshold must not be quietly re-pointed at
  // the new global rule — it keeps answering to the number the user set.
  assert.equal(rows[0].alert_mode, 'custom');
  assert.equal(rows[0].alert_pct, 40);
});

test('a version stamp that lies is repaired instead of bricking the tool', async () => {
  const dir = tempDataDir();
  // Exactly what a half-applied upgrade leaves behind: stamped current, but the
  // columns that version promised were never added.
  const seed = new DatabaseSync(path.join(dir, 'games.db'));
  seed.exec(`
    CREATE TABLE wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, platform TEXT NOT NULL,
      image TEXT, refs TEXT NOT NULL DEFAULT '[]', preferred_region TEXT,
      hide_desc INTEGER NOT NULL DEFAULT 0,
      added_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (title, platform));
    CREATE TABLE price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wishlist_id INTEGER NOT NULL REFERENCES wishlist(id) ON DELETE CASCADE,
      store TEXT NOT NULL, region TEXT, kind TEXT, price REAL NOT NULL, currency TEXT NOT NULL,
      price_ils REAL NOT NULL, checked_at TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, wishlist_id INTEGER REFERENCES wishlist(id) ON DELETE CASCADE,
      title TEXT NOT NULL, message TEXT NOT NULL, price_ils REAL, kind TEXT,
      read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO wishlist (title, platform) VALUES ('Hades II', 'switch');
    PRAGMA user_version = 999;
  `);
  seed.close();

  const db = await loadDb(dir);
  const cols = columns(db.db, 'wishlist');
  for (const c of ['capture_days', 'alert_mode', 'alert_scope', 'alert_price_ccy']) {
    assert.ok(cols.has(c), `${c} was restored`);
  }
  assert.equal(db.listWishlist().length, 1, 'the tracked game survived the repair');
});

test('the global alert rule round-trips, and "off" is not mistaken for "unset"', async () => {
  const db = await loadDb(tempDataDir());
  assert.equal(db.getAlertDefaults().pct, db.DEFAULT_ALERT.pct); // ships enabled
  db.setAlertDefaults({ pct: null, price: 150, ccy: 'USD', anyDrop: false, scope: 'physical' });
  assert.deepEqual(db.getAlertDefaults(), {
    pct: null, // explicitly turned off — must NOT fall back to the built-in default
    price: 150,
    ccy: 'USD',
    anyDrop: false,
    scope: 'physical',
  });
});

test('sharing a tracking file merges without losing or duplicating anything', async () => {
  const db = await loadDb(tempDataDir());
  const mine = db.addToWishlist({ title: 'Elden Ring', platform: 'pc', refs: [{ sourceId: 'steam-regional', sourceGameId: '1245620' }] });
  db.setPreferredRegion(mine.id, 'IL');
  db.recordOffers(mine.id, [{ store: 'Steam', region: 'IL', kind: 'digital', price: 183, currency: 'ILS', priceILS: 183 }], '2026-07-01 10:00:00');

  // Round-tripping my own file must change nothing at all.
  const exported = db.exportAll();
  assert.deepEqual(db.importAll({ items: exported }), { games: 0, points: 0 });
  assert.equal(db.listWishlist().length, 1);
  assert.equal(db.bestPerCheck(mine.id).length, 1);

  // A friend's file: one check I already have, one I don't, plus a game I don't track.
  const friend = [
    {
      title: 'Elden Ring',
      platform: 'pc',
      image: null,
      refs: [{ sourceId: 'cheapshark', sourceGameId: '612' }],
      preferred_region: 'US',
      added_at: '2026-01-01 00:00:00',
      history: [
        { store: 'Steam', region: 'IL', kind: 'digital', price: 183, currency: 'ILS', price_ils: 183, checked_at: '2026-07-01 10:00:00' },
        { store: 'Steam', region: 'IL', kind: 'digital', price: 149, currency: 'ILS', price_ils: 149, checked_at: '2026-07-15 10:00:00' },
      ],
    },
    {
      title: 'Hades II',
      platform: 'switch',
      image: null,
      refs: [{ sourceId: 'nintendo-eshop', sourceGameId: 'hades-ii' }],
      preferred_region: null,
      added_at: '2026-05-05 00:00:00',
      history: [
        { store: 'eShop', region: 'US', kind: 'digital', price: 29.99, currency: 'USD', price_ils: 99, checked_at: '2026-07-20 10:00:00' },
      ],
    },
  ];
  assert.deepEqual(db.importAll({ items: friend }), { games: 1, points: 2 }, 'only the genuinely new rows');

  const rows = db.listWishlist();
  assert.equal(rows.length, 2);
  const eldenAfter = rows.find((r) => r.title === 'Elden Ring');
  // My own region choice survives someone else's file.
  assert.equal(eldenAfter.preferred_region, 'IL');
  // Their source ref is adopted alongside mine, so future checks cover both.
  assert.equal(JSON.parse(eldenAfter.refs).length, 2);
  assert.equal(db.bestPerCheck(eldenAfter.id).length, 2, 'their extra check joined my history');
});

test('alert scopes read the right price series for the game', async () => {
  const db = await loadDb(tempDataDir());
  const row = db.addToWishlist({ title: 'EA Sports FC 25', platform: 'ps5', refs: [] });
  // One check that recorded all three kinds of offer at once.
  db.recordOffers(
    row.id,
    [
      { store: 'PSN US', region: 'US', kind: 'digital', price: 40, currency: 'USD', priceILS: 150 },
      { store: 'PSN IL', region: 'IL', kind: 'digital', price: 180, currency: 'ILS', priceILS: 180 },
      { store: 'Ivory', kind: 'physical', price: 119, currency: 'ILS', priceILS: 119 },
      { store: 'Kinguin', kind: 'digital', price: 90, currency: 'ILS', priceILS: 90 },
    ],
    '2026-02-01 10:00:00'
  );
  const priceOf = (scope, region = null) => db.bestPerCheckForScope(row.id, scope, region)[0]?.price_ils;

  assert.equal(priceOf('any'), 90, 'cheapest of everything');
  assert.equal(priceOf('physical'), 119, 'the disc');
  assert.equal(priceOf('cdkey'), 90, 'the key seller (digital, no region)');
  assert.equal(priceOf('official'), 150, 'cheapest in-platform store price');
  assert.equal(priceOf('official', 'IL'), 180, 'pinned to the tracked region');
  assert.equal(priceOf('auto', 'IL'), 180, 'follows the pinned region, like the tracking list');
  assert.equal(priceOf('auto'), 90, 'no region pinned → the headline cheapest');
  // A region the game isn't sold in must not silence its alerts.
  assert.equal(priceOf('auto', 'JP'), 90);
  assert.equal(priceOf('official', 'JP'), 150);
});
