import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * End-to-end alert behaviour: a price is recorded, and either the bell gets a
 * line about it or it doesn't. Runs the real notify.ts against a real (throwaway)
 * database, so the wiring between the rule, the price history and the
 * notification row is covered — not just the pure decision function.
 *
 * One database for the file, one game per test: notify.ts imports db.ts by plain
 * specifier, so per-test module cache-busting would hand the two modules
 * different databases. Isolation comes from unique titles instead, and every test
 * states the global rule it relies on rather than inheriting the previous one's.
 */
process.env.VGPT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vgpt-notify-'));
const db = await import('./db.ts');
const { evaluateAlerts } = await import('./notify.ts');

let seq = 0;

/** Track a new game and record one check per price list given, oldest first. */
function seed(prices, patch) {
  const row = db.addToWishlist({ title: `Test Game ${++seq}`, platform: 'ps5', refs: [] });
  prices.forEach((offers, i) => {
    db.recordOffers(row.id, offers, `2026-03-${String(i + 1).padStart(2, '0')} 10:00:00`);
  });
  if (patch) db.db.prepare(`UPDATE wishlist SET ${patch} WHERE id = ?`).run(row.id);
  return db.getWishlistRow(row.id);
}

/** Notifications belonging to one game, newest first. */
const notesFor = (row) => db.listNotifications(200).filter((n) => n.wishlist_id === row.id);

const disc = (price) => [{ store: 'Ivory', kind: 'physical', price, currency: 'ILS', priceILS: price }];

test('a cheaper price than last time reaches the bell, with the numbers in it', async () => {
  db.setAlertDefaults({ ...db.DEFAULT_ALERT });
  const row = seed([disc(199), disc(149)]);

  const fired = await evaluateAlerts(row);
  assert.ok(fired, 'a drop is reported');
  const [note] = notesFor(row);
  assert.equal(note.title, row.title);
  assert.equal(note.platform, 'ps5');
  assert.equal(note.price_ils, 149);
  assert.equal(note.read, 0, 'arrives unread so the bell lights up');
  // The message must say what happened, in what currency, and to which price.
  assert.match(note.message, /₪199\.00/);
  assert.match(note.message, /₪149\.00/);
  assert.match(note.message, /דיסק/);
  assert.match(note.message, /Ivory/);
});

test('a price that did not move says nothing at all', async () => {
  db.setAlertDefaults({ ...db.DEFAULT_ALERT });
  const row = seed([disc(199), disc(199)]);
  assert.equal(await evaluateAlerts(row), null);
  assert.equal(notesFor(row).length, 0);
});

test('the first price ever recorded is not a drop', async () => {
  db.setAlertDefaults({ ...db.DEFAULT_ALERT });
  const row = seed([disc(149)]);
  assert.equal(await evaluateAlerts(row), null);
  assert.equal(notesFor(row).length, 0);
});

test('a game that stays on sale is not reported over and over', async () => {
  // Only the percentage rule, so "still 40% off" must stay quiet on later checks.
  db.setAlertDefaults({ anyDrop: false, pct: 30, price: null, scope: 'auto' });
  const row = seed([disc(200), disc(120)]);
  assert.equal((await evaluateAlerts(row)).reason, 'pct', 'the crossing is reported once');

  db.recordOffers(row.id, disc(118), '2026-03-03 10:00:00'); // still deeply discounted
  assert.equal(await evaluateAlerts(row), null, 'no second word about the same sale');
  assert.equal(notesFor(row).length, 1);
});

test('a muted game stays silent however far it falls', async () => {
  db.setAlertDefaults({ ...db.DEFAULT_ALERT });
  const row = seed([disc(400), disc(40)], `alert_mode = 'off'`);
  assert.equal(await evaluateAlerts(row), null);
  assert.equal(notesFor(row).length, 0);
});

test('a game is judged on the price it is tracked for, not the cheapest one', async () => {
  db.setAlertDefaults({ ...db.DEFAULT_ALERT });
  // Tracked for its US store price. The disc gets cheaper; the store price doesn't.
  const store = (priceILS) => ({
    store: 'PSN US',
    region: 'US',
    kind: 'digital',
    price: 60,
    currency: 'USD',
    priceILS,
  });
  const row = seed(
    [
      [store(220), ...disc(199)],
      [store(220), ...disc(99)],
    ],
    `alert_scope = 'official', preferred_region = 'US'`
  );
  assert.equal(await evaluateAlerts(row), null, 'the watched store price never moved');
  assert.equal(notesFor(row).length, 0);

  // The same history, watched as a disc instead, is news.
  db.setAlertScope(row.id, 'physical');
  const asDisc = await evaluateAlerts(db.getWishlistRow(row.id));
  assert.ok(asDisc, 'the disc price dropped, so the disc watcher hears about it');
  assert.match(notesFor(row)[0].message, /₪99\.00/);
});

test("a game's own threshold overrides the global rule", async () => {
  db.setAlertDefaults({ anyDrop: true, pct: 20, price: null, scope: 'auto' });
  const row = seed(
    [disc(300), disc(250)],
    `alert_mode = 'custom', alert_price = 150, alert_price_ccy = 'ILS'`
  );
  assert.equal(await evaluateAlerts(row), null, '₪250 is a drop, but not the ₪150 asked for');

  db.recordOffers(row.id, disc(140), '2026-03-03 10:00:00');
  const hit = await evaluateAlerts(db.getWishlistRow(row.id));
  assert.equal(hit.reason, 'price');
  assert.match(hit.message, /150\.00/, 'the message names the threshold that was met');
});
