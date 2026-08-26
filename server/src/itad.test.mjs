import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itad } from './adapters/itad.ts';
import { bestLows } from './fanout.ts';

/**
 * The lowest price ever recorded, read out of a response we already download.
 *
 * ITAD returns `historyLow` in the SAME body as the deals, and it was being
 * parsed past and dropped. The reason it is worth a test is that the number is
 * an outside party's claim about the past: it must stay attributed, must keep
 * the currency it was recorded in, and must never quietly become an offer — a
 * price nobody can buy at today, sitting in a list of prices you can, is the
 * one way this feature could actively mislead.
 */

const real = globalThis.fetch;
const KEY_ENV = process.env.ITAD_API_KEY;

/** ITAD's two calls, stubbed: lookup (appid → uuid) and prices (uuid → body). */
function withItad(priceBody, fn) {
  process.env.ITAD_API_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('open.er-api.com')) {
      return new Response(JSON.stringify({ result: 'success', rates: { USD: 0.27 } }), { status: 200 });
    }
    if (u.includes('/games/lookup/')) {
      return new Response(JSON.stringify({ found: true, game: { id: 'uuid-1' } }), { status: 200 });
    }
    if (u.includes('/games/prices/')) {
      return new Response(JSON.stringify(priceBody), { status: 200 });
    }
    // The shop registry ITAD asks CheapShark for; an empty one is fine here.
    return new Response(JSON.stringify([]), { status: 200 });
  };
  return fn().finally(() => {
    globalThis.fetch = real;
    if (KEY_ENV === undefined) delete process.env.ITAD_API_KEY;
    else process.env.ITAD_API_KEY = KEY_ENV;
  });
}

const entry = (extra) => [
  {
    id: 'uuid-1',
    deals: [
      {
        shop: { id: 61, name: 'Some Keyshop' },
        price: { amount: 19.99, currency: 'USD' },
        regular: { amount: 59.99, currency: 'USD' },
        cut: 67,
        url: 'https://example.test/deal',
      },
    ],
    ...extra,
  },
];

test('the recorded lows come back attributed, in the currency they were recorded in', async () => {
  // Distinct titles/ids per test: the adapter caches appid → uuid per process.
  const body = entry({
    historyLow: {
      all: { amount: 5.99, currency: 'USD' },
      y1: { amount: 9.99, currency: 'USD' },
      m3: { amount: 14.99, currency: 'USD' },
    },
  });
  const result = await withItad(body, () => itad.getOffers('700010', 'pc'));

  assert.equal(result.lows.length, 3, 'all three windows ITAD publishes');
  const all = result.lows.find((l) => l.window === 'all');
  assert.equal(all.price, 5.99);
  assert.equal(all.currency, 'USD', 'the original currency survives — the shekel figure is a conversion');
  assert.ok(all.priceILS > 0);
  assert.equal(all.source, 'IsThereAnyDeal', 'somebody else observed this, and is named');
});

test('a low is never mixed into the offers', async () => {
  // The whole risk of this feature: a price nobody can pay today appearing in a
  // list of prices you can.
  const body = entry({ historyLow: { all: { amount: 1.11, currency: 'USD' } } });
  const result = await withItad(body, () => itad.getOffers('700011', 'pc'));
  assert.ok(!result.offers.some((o) => o.price === 1.11), 'the historic low must not become a row');
  assert.equal(result.offers.length, 1);
});

test('a game with no recorded history simply has none', async () => {
  const result = await withItad(entry({}), () => itad.getOffers('700012', 'pc'));
  assert.deepEqual(result.lows, [], 'absent is absent — not zero, and not the current price');
});

test('a zero or missing amount is ignored rather than shown as free', async () => {
  const body = entry({ historyLow: { all: { amount: 0, currency: 'USD' }, y1: { currency: 'USD' } } });
  const result = await withItad(body, () => itad.getOffers('700013', 'pc'));
  assert.deepEqual(result.lows, []);
});

test('when two trackers disagree the LOWEST is the lowest-ever', () => {
  // Only one source reports lows today. This is what keeps the answer correct
  // when a second one starts: the lowest a game has ever been is the lowest
  // anybody saw, not whatever the last responder happened to have.
  const lows = [
    { price: 9, currency: 'USD', priceILS: 33, window: 'all', source: 'A' },
    { price: 5, currency: 'USD', priceILS: 18, window: 'all', source: 'B' },
    { price: 12, currency: 'USD', priceILS: 44, window: 'y1', source: 'A' },
  ];
  const best = bestLows(lows);
  assert.equal(best.length, 2, 'one per window');
  assert.equal(best[0].window, 'all', 'widest window first — it is the headline');
  assert.equal(best[0].source, 'B');
  assert.equal(best[1].window, 'y1');
});
