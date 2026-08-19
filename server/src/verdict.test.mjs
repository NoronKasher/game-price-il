import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceVerdict } from './verdict.ts';

/** Build a newest-first series from [daysAgo, price] pairs. */
function series(pairs) {
  const now = Date.UTC(2026, 6, 29, 12, 0, 0);
  return pairs.map(([daysAgo, price]) => ({
    price_ils: price,
    checked_at: new Date(now - daysAgo * 86_400_000).toISOString().replace('T', ' ').slice(0, 19),
  }));
}

test('one check alone says nothing', () => {
  assert.equal(priceVerdict([]), null);
  assert.equal(priceVerdict(series([[0, 99]])), null, 'a single point cannot be a record');
});

test('sitting at the lowest price ever is a record', () => {
  const v = priceVerdict(series([[0, 85.9], [30, 120], [60, 149]]));
  assert.equal(v.kind, 'record');
  assert.equal(v.lowILS, 85.9);
  assert.equal(v.pctAboveLow, 0);
});

test('a record survives exchange-rate wobble around the old low', () => {
  // Today ₪86.40 against a former low of ₪85.90 — 0.6% apart, which is drift,
  // not a miss. Calling that "above the low" would be technically true and wrong.
  const v = priceVerdict(series([[0, 86.4], [40, 85.9], [80, 149]]));
  assert.equal(v.kind, 'record');
});

test('cheapest in months is reported when nothing cheaper is recent', () => {
  const v = priceVerdict(series([[0, 102], [20, 130], [50, 140], [95, 88]]));
  assert.equal(v.kind, 'cheapest-since');
  assert.equal(v.daysSinceCheaper, 95);
  assert.equal(v.lowILS, 88);
  assert.equal(v.pctAboveLow, 16);
});

test('a cheaper price last week is not worth celebrating', () => {
  const v = priceVerdict(series([[0, 102], [6, 90], [40, 88]]));
  assert.equal(v.kind, 'above-low');
  assert.equal(v.lowILS, 88);
});

test('above the low reports how far above it sits', () => {
  const v = priceVerdict(series([[0, 149], [10, 100], [20, 120]]));
  assert.equal(v.kind, 'above-low');
  assert.equal(v.pctAboveLow, 49);
  assert.equal(v.lowILS, 100);
});

test('reports when the price last moved, and which way', () => {
  // Dropped 149 -> 102 three days ago: the drop is the news, since no source we
  // read can tell us when the sale ENDS.
  const dropped = priceVerdict(series([[0, 102], [3, 102], [4, 149], [30, 149]]));
  assert.equal(dropped.changeDirection, 'down');
  assert.equal(dropped.changedDaysAgo, 3);

  // A rise is reported too, so the UI can choose to stay quiet about it. The
  // count is "how long the CURRENT price has been in place" — here we first saw
  // ₪149 at today's check, so it is 0 days old, not 2.
  const rose = priceVerdict(series([[0, 149], [2, 102], [20, 102]]));
  assert.equal(rose.changeDirection, 'up');
  assert.equal(rose.changedDaysAgo, 0);

  // A flat series has no change to report at all.
  const flat = priceVerdict(series([[0, 120], [10, 120], [20, 120]]));
  assert.equal(flat.changeDirection, undefined);
  assert.equal(flat.changedDaysAgo, undefined);

  // Exchange-rate wobble is not a price move.
  const wobble = priceVerdict(series([[0, 120.4], [10, 120], [20, 120.2]]));
  assert.equal(wobble.changeDirection, undefined);
});

test('the low can be today even when an older check tied it', () => {
  const v = priceVerdict(series([[0, 88], [30, 88], [60, 149]]));
  assert.equal(v.kind, 'record');
  assert.equal(v.pctAboveLow, 0);
});
