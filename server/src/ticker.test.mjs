import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickerDeals } from './ticker.ts';

/**
 * The deals ticker's filtering.
 *
 * This is the strip of text along the top of the app, so its failures are the
 * embarrassing kind: the same game five times because five stores discount it,
 * or "₪12 — was ₪NaN". Both come from trusting a feed's strings, and both are
 * cheap to pin down here.
 *
 * Every call is stubbed. The real feed is a live third-party endpoint whose
 * contents change hourly, and a test that asserts on today's sales is a test
 * that fails tomorrow for no reason.
 */

const real = globalThis.fetch;

/** Replace fetch for one test — both the deals feed and the exchange-rate lookup. */
async function withFeed(deals, fn) {
  globalThis.fetch = async (url) => {
    if (String(url).includes('cheapshark')) {
      return new Response(JSON.stringify(deals), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // The rates endpoint. A fixed rate keeps the assertions about filtering
    // rather than about today's dollar.
    return new Response(JSON.stringify({ result: 'success', rates: { USD: 0.25 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const deal = (over) => ({
  title: 'Some Game',
  salePrice: '10.00',
  normalPrice: '40.00',
  savings: '75.000000',
  steamRatingPercent: '92',
  ...over,
});

test('the same game listed by several stores appears once', async () => {
  const deals = await withFeed(
    [deal({ salePrice: '10.00' }), deal({ salePrice: '11.00' }), deal({ title: 'Other Game' })],
    () => tickerDeals()
  );
  assert.deepEqual(
    deals.map((d) => d.title),
    ['Some Game', 'Other Game']
  );
});

test('a price that will not parse is dropped, not shown as NaN', async () => {
  // An unparseable normalPrice used to reach the client as JSON null and render
  // a blank "original price" beside a perfectly good sale price.
  const deals = await withFeed(
    [
      deal({ title: 'Broken Normal', normalPrice: 'N/A' }),
      deal({ title: 'Broken Sale', salePrice: '' }),
      deal({ title: 'Free-ish', salePrice: '0.00' }),
      deal({ title: 'Good One' }),
    ],
    () => tickerDeals()
  );
  assert.deepEqual(
    deals.map((d) => d.title),
    ['Good One']
  );
  for (const d of deals) {
    assert.ok(Number.isFinite(d.salePrice) && Number.isFinite(d.normalPrice));
  }
});

test('prices arrive in shekels, with the agorot kept', async () => {
  const deals = await withFeed([deal({ salePrice: '9.99', normalPrice: '39.99' })], () => tickerDeals());
  // 9.99 USD at 4 ILS per USD. Rounding to whole shekels here distorted the
  // number the user sees once the client formats it back into dollars.
  assert.ok(deals[0].salePrice > 39 && deals[0].salePrice < 41, `got ${deals[0].salePrice}`);
  assert.notEqual(deals[0].salePrice, Math.round(deals[0].salePrice));
});

test('the strip is capped rather than unbounded', async () => {
  const many = Array.from({ length: 40 }, (_, i) => deal({ title: `Game ${i}` }));
  const deals = await withFeed(many, () => tickerDeals());
  assert.equal(deals.length, 15);
});

test('a feed that is down yields an empty strip, never a thrown page', async () => {
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    assert.deepEqual(await tickerDeals(), []);
  } finally {
    globalThis.fetch = real;
  }

  globalThis.fetch = async () => new Response('nope', { status: 503 });
  try {
    assert.deepEqual(await tickerDeals(), []);
  } finally {
    globalThis.fetch = real;
  }
});
