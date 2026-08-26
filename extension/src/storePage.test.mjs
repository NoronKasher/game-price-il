import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Reading a storefront's own product page.
 *
 * Two failures matter here and neither is loud. The first is identifying the
 * WRONG game: the panel would then compare prices for something the person is
 * not looking at, with complete confidence. The second is reading the wrong
 * number as the price — store pages are full of digits, and "-50%" or a review
 * count parses as beautifully as a price does.
 *
 * So these cases pin what counts as a product page, what a title is once the
 * store's furniture is off it, and what the price parser refuses.
 */

const { parseStorePrice, cleanPageTitle, readStorePage, readPublishedOffer } = await import('./storePage.ts');

/* ── Prices ──────────────────────────────────────────────────────────────── */

test('the usual currencies parse', () => {
  assert.deepEqual(parseStorePrice('₪189.90'), { price: 189.9, currency: 'ILS' });
  assert.deepEqual(parseStorePrice('$59.99'), { price: 59.99, currency: 'USD' });
  assert.deepEqual(parseStorePrice('£49.99'), { price: 49.99, currency: 'GBP' });
  assert.deepEqual(parseStorePrice('₺1.299,00'), { price: 1299, currency: 'TRY' });
});

test('the last separator is the decimal one', () => {
  // Backwards, this turns €1.234 into €1.23 — a tenth of the real price, shown
  // as a saving.
  assert.deepEqual(parseStorePrice('€1.234,56'), { price: 1234.56, currency: 'EUR' });
  assert.deepEqual(parseStorePrice('$1,234.56'), { price: 1234.56, currency: 'USD' });
});

test('a number with no currency is not a price', () => {
  // "-50%", "12,431 reviews", "4.7". Every one of these sits next to the real
  // price on a store page.
  assert.equal(parseStorePrice('-50%'), null);
  assert.equal(parseStorePrice('12,431'), null);
  assert.equal(parseStorePrice('4.7'), null);
  assert.equal(parseStorePrice('Free To Play'), null);
});

test('zero and negative are refused', () => {
  assert.equal(parseStorePrice('$0.00'), null);
  assert.equal(parseStorePrice('$-5'), null);
});

/* ── Titles ──────────────────────────────────────────────────────────────── */

test("the store's own furniture comes off the title", () => {
  assert.equal(cleanPageTitle('Save 50% on ELDEN RING on Steam'), 'ELDEN RING');
  assert.equal(cleanPageTitle('Buy Cyberpunk 2077 | Xbox'), 'Cyberpunk 2077');
  assert.equal(cleanPageTitle('Hollow Knight: Silksong - GOG.com'), 'Hollow Knight: Silksong');
  assert.equal(cleanPageTitle('The Witcher 3: Wild Hunt™'), 'The Witcher 3: Wild Hunt');
});

test('a plain title is left alone', () => {
  assert.equal(cleanPageTitle('Baldur’s Gate 3'), 'Baldur’s Gate 3');
});

/* ── Which pages count ───────────────────────────────────────────────────── */

/**
 * A minimal document stand-in.
 *
 * `blocks` models what a real store page has and a naive stub does not: several
 * purchase containers, only the first of which is this game. `document`
 * resolves the heading and the containers; each container resolves its own
 * prices — which is exactly the scoping the reader has to get right.
 */
function withPage({ title = '', heading = null, blocks = [], jsonLd = null }, fn) {
  const container = (prices) => ({
    querySelector: (sel) => (prices[sel] ? { textContent: prices[sel] } : null),
  });
  const containers = blocks.map(container);
  const headingSelectors = ['#appHubAppName', '.apphub_AppName', 'h1', 'h1.productcard-basics__title'];

  globalThis.document = {
    title,
    querySelector: (sel) => {
      if (heading && headingSelectors.includes(sel)) return { textContent: heading };
      // Any container selector resolves to the FIRST block, as the DOM would.
      if (/purchase|product-actions|Acquisition|mfeCtaMain|BuyButton|PurchaseCTA|ctaWithPrice|ProductHero|ProductDetailsHeader|productcard-basics/.test(sel))
        return containers[0] ?? null;
      return null;
    },
    // The page's own published structured data, when it has any.
    querySelectorAll: (sel) =>
      sel.includes('ld+json') && jsonLd ? [{ textContent: JSON.stringify(jsonLd) }] : [],
  };
  try {
    return fn();
  } finally {
    delete globalThis.document;
  }
}

test('a Steam product page is recognised and read', () => {
  const page = withPage({ heading: 'ELDEN RING', blocks: [{ '.game_purchase_price': '₪199.00' }] }, () =>
    readStorePage('https://store.steampowered.com/app/1245620/ELDEN_RING/')
  );
  assert.equal(page.store, 'steam');
  assert.equal(page.title, 'ELDEN RING');
  assert.equal(page.price, 199);
  assert.equal(page.currency, 'ILS');
});

test('a store page that is not a product page shows nothing', () => {
  // The search results, the wishlist, the front page: all on the same host, and
  // every one of them would produce a confident comparison for nothing.
  for (const url of [
    'https://store.steampowered.com/',
    'https://store.steampowered.com/search/?term=elden',
    'https://www.gog.com/en/games',
    'https://www.xbox.com/en-IL/games',
  ]) {
    assert.equal(withPage({ heading: 'Whatever', blocks: [] }, () => readStorePage(url)), null, url);
  }
});

test('a page with no readable title is not guessed at', () => {
  // A half-rendered SPA shell. Comparing prices for "" or for the store's name
  // is worse than waiting.
  assert.equal(
    withPage({ title: '', heading: null, blocks: [] }, () => readStorePage('https://store.steampowered.com/app/1245620/')),
    null
  );
});

test('a price we cannot read still leaves a usable panel', () => {
  // Knowing WHICH game you are looking at is enough to compare. A markup change
  // at one store should cost the direct comparison, not the whole feature.
  const page = withPage({ heading: 'ELDEN RING', blocks: [{}] }, () =>
    readStorePage('https://store.steampowered.com/app/1245620/')
  );
  assert.equal(page.title, 'ELDEN RING');
  assert.equal(page.price, undefined);
});

test("a bundle's price is never mistaken for the game's", () => {
  // The bug a live page caught. Metro 2033 Redux has the game in one purchase
  // block and a bundle in the next; the game's block had no discount element,
  // so a document-wide ".wrapper .discount_final_price" returned the BUNDLE's
  // ₪102.22 instead of the game's ₪79.00 — a comparison against a different
  // product, reported with total confidence.
  const page = withPage(
    {
      heading: 'Metro 2033 Redux',
      blocks: [{ '.game_purchase_price': '₪79.00' }, { '.discount_final_price': '₪102.22' }],
    },
    () => readStorePage('https://store.steampowered.com/app/286690/Metro_2033_Redux/')
  );
  assert.equal(page.price, 79, 'the price must come from the first block, not the cheapest selector');
});

test("a discount inside the game's own block still wins over its list price", () => {
  const page = withPage(
    {
      heading: 'Metro 2033 Redux',
      blocks: [{ '.discount_final_price': '₪47.40', '.game_purchase_price': '₪79.00' }],
    },
    () => readStorePage('https://store.steampowered.com/app/286690/Metro_2033_Redux/')
  );
  assert.equal(page.price, 47.4);
});

test("a bare amount is named by the page's own published offer", () => {
  // GOG's visible price element is "17.99" with the currency somewhere else
  // entirely. Without the published offer the amount cannot be used at all, and
  // assuming shekels would invent a saving out of an exchange rate.
  const page = withPage(
    {
      heading: 'Cyberpunk 2077',
      blocks: [{ '.product-actions-price__final-amount': '17.99' }],
      jsonLd: { '@type': 'Product', name: 'Cyberpunk 2077', offers: { price: '17.99', priceCurrency: 'EUR' } },
    },
    () => readStorePage('https://www.gog.com/en/game/cyberpunk_2077')
  );
  assert.equal(page.price, 17.99);
  assert.equal(page.currency, 'EUR');
});

test('an amount with no currency anywhere is dropped, not assumed', () => {
  const page = withPage(
    { heading: 'Cyberpunk 2077', blocks: [{ '.product-actions-price__final-amount': '17.99' }] },
    () => readStorePage('https://www.gog.com/en/game/cyberpunk_2077')
  );
  assert.equal(page.title, 'Cyberpunk 2077', 'the panel still works');
  assert.equal(page.price, undefined, 'but claims no price it cannot name');
  assert.equal(page.currency, undefined);
});

test('what the page shows beats what it publishes', () => {
  // Structured data can carry a default-region figure. The number in front of
  // the user is the one they are deciding on.
  const page = withPage(
    {
      heading: 'A Game',
      blocks: [{ '.game_purchase_price': '₪199.00' }],
      jsonLd: { '@type': 'Product', offers: { price: '59.99', priceCurrency: 'USD' } },
    },
    () => readStorePage('https://store.steampowered.com/app/1/')
  );
  assert.equal(page.price, 199);
  assert.equal(page.currency, 'ILS');
});

test('a published offer inside a @graph is found', () => {
  const found = (() => {
    globalThis.document = {
      querySelectorAll: () => [
        { textContent: JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { offers: { price: '9.99', priceCurrency: 'GBP' } }] }) },
      ],
    };
    try {
      return readPublishedOffer();
    } finally {
      delete globalThis.document;
    }
  })();
  assert.deepEqual(found, { price: 9.99, currency: 'GBP' });
});

test('GOG puts its discount in the page title, and it is not part of the name', () => {
  assert.equal(cleanPageTitle('-70% Cyberpunk 2077 | GOG.com'), 'Cyberpunk 2077');
});

test('the document title is the fallback when the heading has not rendered', () => {
  const page = withPage({ title: 'Save 50% on ELDEN RING on Steam', heading: null, blocks: [] }, () =>
    readStorePage('https://store.steampowered.com/app/1245620/')
  );
  assert.equal(page.title, 'ELDEN RING');
});

test('every supported storefront is matched on its product URL', () => {
  const cases = [
    ['https://store.steampowered.com/app/1245620/ELDEN_RING/', 'steam'],
    ['https://www.gog.com/en/game/cyberpunk_2077', 'gog'],
    ['https://www.xbox.com/en-IL/games/store/elden-ring/9P3J32CTXLRZ', 'xbox'],
    ['https://store.playstation.com/en-il/product/EP0700-PPSA01330_00-ELDENRING0000000', 'playstation'],
    ['https://www.nintendo.com/us/store/products/hollow-knight-switch/', 'nintendo'],
    ['https://store.epicgames.com/en-US/p/cyberpunk-2077', 'epic'],
  ];
  for (const [url, expected] of cases) {
    const page = withPage({ heading: 'A Game', blocks: [] }, () => readStorePage(url));
    assert.equal(page?.store, expected, url);
  }
});
