import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleFor, bundlesForApp, pricesFor, verdictFor } from './bundle.ts';

/**
 * The bundle checker.
 *
 * The arithmetic is trivial and the edge cases are not, which is the usual
 * shape of a feature that quietly tells people the wrong thing. Two of these
 * cases are the ones that would actually mislead somebody into a purchase:
 * a component Steam does not sell separately must never be counted as free,
 * and an edition must never be presented as a bundle.
 */

const real = globalThis.fetch;

/** Stub the two Steam endpoints this module talks to. */
function withSteam({ packages = {}, apps = {}, appPackages = {} }, fn) {
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname.endsWith('/packagedetails')) {
      const id = u.searchParams.get('packageids');
      const entry = packages[id];
      return new Response(JSON.stringify({ [id]: entry ?? { success: false } }), { status: 200 });
    }
    if (u.pathname.endsWith('/appdetails')) {
      const ids = (u.searchParams.get('appids') ?? '').split(',');
      // price_overview form: many ids at once.
      if (u.searchParams.get('filters') === 'price_overview') {
        const body = {};
        for (const id of ids) {
          const price = apps[id];
          body[id] =
            price === undefined
              ? { success: true, data: {} }
              : { success: true, data: { price_overview: { final: price, currency: 'ILS' } } };
        }
        return new Response(JSON.stringify(body), { status: 200 });
      }
      // full form: used only to read a game's package ids.
      const id = ids[0];
      return new Response(
        JSON.stringify({ [id]: { success: true, data: { packages: appPackages[id] ?? [] } } }),
        { status: 200 }
      );
    }
    if (u.hostname.includes('er-api')) {
      return new Response(JSON.stringify({ result: 'success', rates: { USD: 0.27 } }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${u}`);
  };
  return fn().finally(() => {
    globalThis.fetch = real;
  });
}

/** The Orange Box, as Steam actually returns it. */
const ORANGE_BOX = {
  success: true,
  data: {
    name: 'The Orange Box',
    apps: [
      { id: 220, name: 'Half-Life 2' },
      { id: 320, name: 'Half-Life 2: Deathmatch' },
      { id: 340, name: 'Half-Life 2: Lost Coast' },
      { id: 400, name: 'Portal' },
    ],
    price: { currency: 'ILS', final: 7395, individual: 7390, discount_percent: 0 },
  },
};

/* ── Reading a bundle ────────────────────────────────────────────────────── */

test('a bundle comes back with every game priced', async () => {
  const bundle = await withSteam(
    { packages: { 469: ORANGE_BOX }, apps: { 220: 3695, 400: 3695 } },
    () => bundleFor('469')
  );
  assert.equal(bundle.name, 'The Orange Box');
  assert.equal(bundle.apps.length, 4);
  assert.equal(bundle.priceILS, 73.95);
  assert.equal(bundle.apps.find((a) => a.appId === '220').priceILS, 36.95);
});

test('a game Steam does not sell separately is null, never zero', async () => {
  // Lost Coast and Deathmatch have no standalone price. Counting them as free
  // would understate what buying "the rest" actually costs — which is the one
  // way this feature could talk somebody into the wrong purchase.
  const bundle = await withSteam(
    { packages: { 469: ORANGE_BOX }, apps: { 220: 3695, 400: 3695 } },
    () => bundleFor('469')
  );
  assert.equal(bundle.apps.find((a) => a.appId === '340').priceILS, null);
  assert.equal(bundle.apps.find((a) => a.appId === '320').priceILS, null);
});

test("our own sum agrees with Steam's individual total", async () => {
  // Two independent numbers. Measured against the live store, both were 7390.
  const bundle = await withSteam(
    { packages: { 469: ORANGE_BOX }, apps: { 220: 3695, 400: 3695 } },
    () => bundleFor('469')
  );
  const ours = bundle.apps.reduce((n, a) => n + (a.priceILS ?? 0), 0);
  assert.equal(Math.round(ours * 100) / 100, bundle.steamIndividualILS);
});

test('an edition is not a bundle', async () => {
  // ELDEN RING lists three packages — standard, Shadow of the Erdtree, Deluxe.
  // Each holds one game. Presenting them as bundles would offer arithmetic on
  // a comparison that does not exist.
  const edition = {
    success: true,
    data: {
      name: 'ELDEN RING Deluxe Edition',
      apps: [{ id: 1245620, name: 'ELDEN RING' }],
      price: { currency: 'ILS', final: 38900, individual: 38900, discount_percent: 0 },
    },
  };
  assert.equal(await withSteam({ packages: { 1010506: edition } }, () => bundleFor('1010506')), null);
});

test('a package that is no longer sold here is skipped', async () => {
  const gone = { success: true, data: { name: 'Old Pack', apps: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }], price: {} } };
  assert.equal(await withSteam({ packages: { 99: gone } }, () => bundleFor('99')), null);
});

test('a package Steam has no data for is null, not an exception', async () => {
  assert.equal(await withSteam({ packages: {} }, () => bundleFor('12345')), null);
});

test('a game with no packages yields no bundles', async () => {
  assert.deepEqual(await withSteam({ appPackages: { 620: [] } }, () => bundlesForApp('620')), []);
});

test('only the multi-game packages survive the sweep', async () => {
  const bundles = await withSteam(
    {
      appPackages: { 220: [469, 1010506] },
      packages: {
        469: ORANGE_BOX,
        1010506: {
          success: true,
          data: {
            name: 'Half-Life 2 Standard',
            apps: [{ id: 220, name: 'Half-Life 2' }],
            price: { currency: 'ILS', final: 3695 },
          },
        },
      },
      apps: { 220: 3695, 400: 3695 },
    },
    () => bundlesForApp('220')
  );
  assert.equal(bundles.length, 1);
  assert.equal(bundles[0].name, 'The Orange Box');
});

/* ── The arithmetic ──────────────────────────────────────────────────────── */

const BUNDLE = {
  packageId: '1',
  name: 'Test Pack',
  priceILS: 100,
  discountPercent: 0,
  steamIndividualILS: 150,
  apps: [
    { appId: 'a', title: 'A', priceILS: 60 },
    { appId: 'b', title: 'B', priceILS: 50 },
    { appId: 'c', title: 'C', priceILS: 40 },
  ],
};

test('owning nothing: the bundle is judged against the full separate price', () => {
  const v = verdictFor(BUNDLE, []);
  assert.equal(v.separateILS, 150);
  assert.equal(v.savingILS, 50, 'the bundle saves ₪50');
  assert.equal(v.ownedCount, 0);
});

test('owning two of three flips the answer', () => {
  // The whole point of the feature. ₪100 for a bundle whose only new game
  // costs ₪40 separately is a bad deal, and no store will tell you that.
  const v = verdictFor(BUNDLE, ['a', 'b']);
  assert.equal(v.separateILS, 40);
  assert.equal(v.savingILS, -60, 'buying the one game alone is ₪60 cheaper');
  assert.equal(v.ownedCount, 2);
});

test('owning everything makes the bundle worth nothing', () => {
  const v = verdictFor(BUNDLE, ['a', 'b', 'c']);
  assert.equal(v.separateILS, 0);
  assert.equal(v.savingILS, -100);
});

test('an unpriceable game is named, not silently treated as free', () => {
  const withFree = { ...BUNDLE, apps: [...BUNDLE.apps, { appId: 'd', title: 'Bonus', priceILS: null }] };
  const v = verdictFor(withFree, ['a']);
  assert.deepEqual(v.unpriceable, ['Bonus']);
  assert.equal(v.separateILS, 90, 'it contributes nothing to the total…');
  // …and because it cannot be bought alone, "buy the rest separately" is not
  // actually an available option. The UI has to say so rather than print a
  // saving as though it were.
  assert.ok(v.unpriceable.length > 0);
});

test('owned ids that are not in this bundle are ignored', () => {
  const v = verdictFor(BUNDLE, ['a', 'zzz', '']);
  assert.equal(v.ownedCount, 1);
  assert.equal(v.separateILS, 90);
});

test('money comes back rounded to agorot, not to floating-point noise', () => {
  const odd = {
    ...BUNDLE,
    priceILS: 33.33,
    apps: [
      { appId: 'a', title: 'A', priceILS: 11.11 },
      { appId: 'b', title: 'B', priceILS: 22.22 },
    ],
  };
  const v = verdictFor(odd, []);
  assert.equal(v.separateILS, 33.33);
  assert.equal(v.savingILS, 0);
});

/* ── Prices ──────────────────────────────────────────────────────────────── */

test('a foreign-currency price is converted, not shown raw', async () => {
  const real2 = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('er-api')) {
      return new Response(JSON.stringify({ result: 'success', rates: { USD: 0.25 } }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ 1: { success: true, data: { price_overview: { final: 1000, currency: 'USD' } } } }),
      { status: 200 }
    );
  };
  try {
    const prices = await pricesFor(['1']);
    assert.ok(prices.get('1') > 10, 'ten dollars is more than ten shekels');
  } finally {
    globalThis.fetch = real2;
  }
});

test('asking for no apps costs no request', async () => {
  const real2 = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response('{}', { status: 200 });
  };
  try {
    assert.equal((await pricesFor([])).size, 0);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = real2;
  }
});

test('when nothing left can be bought alone, there is no comparison to make', () => {
  // Found by using it. Own the two priced games in The Orange Box and the five
  // that remain have no standalone price, so the separate total is ₪0 — and the
  // card reported "buying separately is ₪73.95 cheaper" about games that cannot
  // be bought separately at any price. That is not an imprecise saving, it is a
  // route that does not exist.
  const bundle = {
    packageId: '1',
    name: 'Pack',
    priceILS: 73.95,
    discountPercent: 0,
    steamIndividualILS: null,
    apps: [
      { appId: 'a', title: 'Priced', priceILS: 36.95 },
      { appId: 'b', title: 'Bonus One', priceILS: null },
      { appId: 'c', title: 'Bonus Two', priceILS: null },
    ],
  };
  const v = verdictFor(bundle, ['a']);
  assert.equal(v.onlyViaBundle, true, 'the bundle is the only way to get the rest');
  assert.equal(v.separateILS, 0);
});

test('a mix of priceable and unpriceable is still a real comparison', () => {
  const bundle = {
    packageId: '1',
    name: 'Pack',
    priceILS: 100,
    discountPercent: 0,
    steamIndividualILS: null,
    apps: [
      { appId: 'a', title: 'Priced', priceILS: 80 },
      { appId: 'b', title: 'Bonus', priceILS: null },
    ],
  };
  const v = verdictFor(bundle, []);
  assert.equal(v.onlyViaBundle, false, 'one of them CAN be bought alone, so the sum means something');
  assert.deepEqual(v.unpriceable, ['Bonus']);
});

test('owning everything is not "only via bundle"', () => {
  const bundle = {
    packageId: '1',
    name: 'Pack',
    priceILS: 100,
    discountPercent: 0,
    steamIndividualILS: null,
    apps: [{ appId: 'a', title: 'A', priceILS: null }],
  };
  assert.equal(verdictFor(bundle, ['a']).onlyViaBundle, false, 'there is nothing left to need');
});
