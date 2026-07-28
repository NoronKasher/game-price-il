import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Capture-on-view behaviour: expanding a tracked game turns the offers it just
 * scraped into a graph point — but only when that point says something new.
 * (Same one-DB-per-file pattern as notify.test.mjs: capture.ts imports db.ts by
 * plain specifier, so isolation comes from a unique game per test.)
 */
process.env.VGPT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vgpt-capture-'));
const db = await import('./db.ts');
const { captureFromView, offersDiffer } = await import('./capture.ts');

let seq = 0;
const newGame = () => db.addToWishlist({ title: `Viewed Game ${++seq}`, platform: 'ps5', refs: [] });
const checksOf = (row) =>
  db.db
    .prepare('SELECT COUNT(DISTINCT checked_at) n FROM price_history WHERE wishlist_id = ?')
    .get(row.id).n;

const offer = (store, priceILS, extra = {}) => ({
  store,
  kind: extra.kind ?? 'physical',
  location: 'israel',
  price: priceILS,
  currency: 'ILS',
  priceILS,
  region: extra.region,
  url: 'https://example.com',
});

test('the first view of a game records its offers as the first graph point', async () => {
  const row = newGame();
  assert.equal(await captureFromView(row, [offer('VGS', 229), offer('Ivory', 199)]), true);
  assert.equal(checksOf(row), 1);
});

test('re-viewing with identical prices adds nothing', async () => {
  const row = newGame();
  await captureFromView(row, [offer('VGS', 229)]);
  assert.equal(await captureFromView(row, [offer('VGS', 229)]), false);
  assert.equal(await captureFromView(row, [offer('VGS', 229)]), false);
  assert.equal(checksOf(row), 1, 'five refreshes an hour must not pile up flat points');
});

test('a changed price becomes a new point AND reaches the sale alerts', async () => {
  db.setAlertDefaults({ ...db.DEFAULT_ALERT }); // anyDrop on
  const row = newGame();
  await captureFromView(row, [offer('VGS', 229)]);
  assert.equal(await captureFromView(row, [offer('VGS', 199)]), true);
  assert.equal(checksOf(row), 2);
  const note = db.listNotifications(200).find((n) => n.wishlist_id === row.id);
  assert.ok(note, 'the drop the view just witnessed rings the bell');
  assert.match(note.message, /₪199\.00/);
});

test('a store appearing or vanishing counts as a change', async () => {
  const row = newGame();
  await captureFromView(row, [offer('VGS', 229)]);
  assert.equal(await captureFromView(row, [offer('VGS', 229), offer('Bug', 249)]), true);
  assert.equal(checksOf(row), 2);
});

test('an empty scrape (all sources down) is an outage, not a data point', async () => {
  const row = newGame();
  await captureFromView(row, [offer('VGS', 229)]);
  assert.equal(await captureFromView(row, []), false);
  assert.equal(checksOf(row), 1);
});

test('unchanged prices still re-anchor once the last point is a day old', async () => {
  const row = newGame();
  // Plant the previous check with an old timestamp, as if last viewed days ago.
  db.recordOffers(
    row.id,
    [{ store: 'VGS', kind: 'physical', price: 229, currency: 'ILS', priceILS: 229 }],
    '2026-07-20 10:00:00'
  );
  assert.equal(await captureFromView(row, [offer('VGS', 229)]), true, 'daily anchor');
  assert.equal(checksOf(row), 2);
});

test('offersDiffer ignores offer order and compares prices down to the agora', () => {
  const prev = [
    { store: 'VGS', region: null, kind: 'physical', price_ils: 229 },
    { store: 'PSN', region: 'US', kind: 'digital', price_ils: 89.6 },
  ];
  assert.equal(offersDiffer(prev, [offer('PSN', 89.6, { kind: 'digital', region: 'US' }), offer('VGS', 229)]), false);
  assert.equal(offersDiffer(prev, [offer('PSN', 89.67, { kind: 'digital', region: 'US' }), offer('VGS', 229)]), true);
});
