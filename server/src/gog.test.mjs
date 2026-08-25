import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gog } from './adapters/gog.ts';

/**
 * GOG's catalog responses, parsed.
 *
 * Every call is stubbed. The real catalog is a live storefront whose prices move
 * hourly, and a test that asserts on today's sale is a test that fails tomorrow
 * for no reason. What is worth pinning is the reading of the response: which
 * listings count as games, how a regional price becomes an offer, and what
 * happens to a region that does not sell the game.
 */

const real = globalThis.fetch;

/** `byCountry` maps a countryCode to the product list that region should return. */
function withCatalog(byCountry, fn) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('open.er-api.com')) {
      return new Response(JSON.stringify({ result: 'success', rates: { USD: 0.25 } }), { status: 200 });
    }
    const country = new URL(u).searchParams.get('countryCode') ?? '';
    const products = byCountry[country] ?? byCountry.default ?? [];
    return new Response(JSON.stringify({ products }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return Promise.resolve(fn()).finally(() => {
    globalThis.fetch = real;
  });
}

const priced = (amount, base) => ({
  finalMoney: { amount: String(amount), currency: 'USD' },
  baseMoney: { amount: String(base ?? amount), currency: 'USD' },
});

const product = (over) => ({
  id: '111',
  title: 'Cyberpunk 2077',
  productType: 'game',
  coverHorizontal: 'https://images.gog-statics.com/abc',
  storeLink: 'https://www.gog.com/en/game/cyberpunk_2077',
  price: priced(17.99, 59.99),
  ...over,
});

test('a catalog listing becomes a PC hit with its art and a stable id', async () => {
  await withCatalog({ default: [product({})] }, async () => {
    const hits = await gog.search('cyberpunk', ['pc']);
    assert.equal(hits.length, 1);
    const h = hits[0];
    assert.equal(h.sourceId, 'gog');
    assert.equal(h.platform, 'pc');
    assert.equal(h.title, 'Cyberpunk 2077');
    assert.ok(h.sourceGameId.startsWith('111~'), 'the product id has to survive into the ref');
    assert.ok(h.image?.endsWith('.jpg'), 'GOG cover URLs carry no extension of their own');
  });
});

test("GOG's own add-on label is believed, not just our title reading", async () => {
  // "Phantom Liberty" has no keyword tell at all; only productType says so.
  await withCatalog(
    { default: [product({ id: '222', title: 'Phantom Liberty', productType: 'dlc' })] },
    async () => {
      const hits = await gog.search('phantom liberty', ['pc']);
      assert.equal(hits[0].dlc, true);
    }
  );
});

test('a console-only search never touches GOG', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('{}', { status: 200 });
  };
  try {
    const hits = await gog.search('elden ring', ['ps5']);
    assert.deepEqual(hits, []);
    assert.equal(called, false, 'GOG sells PC games; a PS5 search should not ask it');
  } finally {
    globalThis.fetch = real;
  }
});

test('each region becomes its own offer, in the currency GOG actually charges', async () => {
  await withCatalog(
    {
      US: [product({ price: priced(17.99, 59.99) })],
      TR: [product({ price: priced(13.49, 59.99) })],
      default: [],
    },
    async () => {
      const offers = await gog.getOffers('111~Cyberpunk%202077', 'pc');
      const us = offers.find((o) => o.region === 'US');
      const tr = offers.find((o) => o.region === 'TR');
      assert.ok(us && tr, 'both priced regions should appear');
      // GOG bills everywhere in dollars — Turkey is fewer USD, not lira. Reading
      // the region's nominal currency instead would misconvert every row.
      assert.equal(tr.currency, 'USD');
      assert.equal(tr.price, 13.49);
      assert.ok(tr.priceILS < us.priceILS, 'Turkey is the cheaper of the two');
      assert.equal(tr.savings, 78, 'discount is measured against GOG\'s own base price');
      assert.ok(tr.url?.includes('gog.com'));
    }
  );
});

test('a region that does not sell the game simply has no row', async () => {
  // A distinct title per test on purpose: the adapter caches by request URL for
  // ten minutes, exactly as the other API-backed adapters do, so reusing a title
  // here would serve the previous test's fixture instead of this one's.
  await withCatalog({ US: [product({ id: '555', title: 'Region Only' })], default: [] }, async () => {
    const offers = await gog.getOffers('555~Region%20Only', 'pc');
    assert.equal(offers.length, 1);
    assert.equal(offers[0].region, 'US');
  });
});

test('a free or unpriced listing is skipped rather than shown as ₪0', async () => {
  await withCatalog(
    {
      US: [product({ id: '666', title: 'Free Thing', price: { finalMoney: { amount: '0', currency: 'USD' } } })],
      default: [],
    },
    async () => {
      assert.deepEqual(await gog.getOffers('666~Free%20Thing', 'pc'), []);
    }
  );
});

test('a catalog that is down costs no offers and throws nothing', async () => {
  globalThis.fetch = async () => new Response('nope', { status: 503 });
  try {
    assert.deepEqual(await gog.search('anything', ['pc']), []);
    assert.deepEqual(await gog.getOffers('111~Anything', 'pc'), []);
  } finally {
    globalThis.fetch = real;
  }
});
