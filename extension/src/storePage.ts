/**
 * Reading the store page you already have open.
 *
 * A price comparison is worth most at the moment somebody is about to buy, and
 * that moment happens on a store's own product page — not later, if they
 * remember to go and look. So: stand on a Steam page and be told the game is
 * ₪40 cheaper in Turkey or on GOG.
 *
 * WHAT IS AND IS NOT HAPPENING HERE.
 *
 * This does not crawl anything. It reads the page the user themselves opened,
 * in their own browser, exactly as the Amazon panel does — the same thing a
 * person does by glancing at the tab. The comparison it then runs is the tool's
 * ordinary search, the one they could have typed by hand.
 *
 * AND IT DOES NOT RUN BY ITSELF. The panel identifies the game and waits for a
 * click. A fan-out is sixteen stores answering, spaced and budgeted, and firing
 * one automatically for every product page anybody idly opens would multiply
 * this tool's footprint by browsing habits rather than by intent. One click is
 * the difference between a tool that is asked and a tool that assumes.
 *
 * Identification is from the URL wherever a store puts a stable id in it, and
 * from the page's own title element otherwise. Nothing is guessed: a page we
 * cannot identify shows no panel at all.
 */

export interface StorePage {
  /** Which storefront this is, for the panel's wording. */
  store: 'steam' | 'gog' | 'xbox' | 'playstation' | 'nintendo' | 'epic';
  /** Display name of the storefront. */
  storeName: string;
  /** The game, as the page calls it. */
  title: string;
  /** The store's own price as printed, when we could read one. */
  price?: number;
  currency?: string;
}

/** Text of the first selector that has any, trimmed, within a root. */
function firstText(selectors: string[], root: ParentNode = document): string | null {
  for (const sel of selectors) {
    const text = root.querySelector(sel)?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

/**
 * The block holding the price for THIS game, scoped before anything is read.
 *
 * A descendant selector run against the whole document finds the first match
 * anywhere, which is not the same as the first match inside the first block —
 * and store pages stack several purchase blocks. Metro 2033 Redux on Steam has
 * the game at ₪79.00 in one block and a bundle at ₪102.22 in the next; asking
 * the document for ".game_area_purchase_game_wrapper .discount_final_price"
 * returns the BUNDLE, because the game's own block had no discount element for
 * that selector to match. The panel would then compare against a price for a
 * different product entirely.
 *
 * So the container is found first, and the price is only ever looked for inside
 * it.
 */
function priceRoot(containers: string[]): ParentNode {
  for (const sel of containers) {
    const node = document.querySelector(sel);
    if (node) return node;
  }
  return document;
}

/**
 * A displayed price → a number and a currency.
 *
 * Strict on purpose. Store pages are full of digits — review counts, discount
 * percentages, "starting at" figures for other editions — and a loose parse
 * records one of those as the price with complete confidence.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/\s|‎|‏|&nbsp;/g, '');
  // A minus in front means this is a discount line ("−₪100 off"), not a price.
  // The digit scan alone happily reads it as a positive number and the panel
  // then advertises a saving that does not exist.
  const match = cleaned.match(/(-|−|–)?(\d[\d.,]*)/);
  if (!match || match[1]) return null;
  const digits = match[2]!;
  // 1.234,56 vs 1,234.56 — the LAST separator is the decimal one. Backwards,
  // this turns €1.234 into €1.23.
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalised: string;
  if (lastDot === -1 && lastComma === -1) normalised = digits;
  else if (lastComma > lastDot) normalised = digits.replace(/\./g, '').replace(',', '.');
  else normalised = digits.replace(/,/g, '');

  const price = Number(normalised);
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** The currency a displayed price names, by symbol or by code. */
export function parseCurrency(text: string): string | null {
  const cleaned = text.replace(/\s|‎|‏|&nbsp;/g, '');
  const code = cleaned.match(/\b(ILS|USD|GBP|EUR|JPY|CAD|AUD|PLN|TRY|BRL|ARS)\b/)?.[1];
  if (code) return code;
  const symbol = cleaned.match(/[₪$£€¥₺]|R\$|CA\$|A\$/)?.[0];
  return (
    { '₪': 'ILS', $: 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₺': 'TRY', 'R$': 'BRL', 'CA$': 'CAD', 'A$': 'AUD' }[
      symbol ?? ''
    ] ?? null
  );
}

export function parseStorePrice(text: string): { price: number; currency: string } | null {
  const currency = parseCurrency(text);
  if (!currency) return null;
  const price = parseAmount(text);
  return price === null ? null : { price, currency };
}

/**
 * The price the page PUBLISHES about itself.
 *
 * Several of these storefronts emit a schema.org Product carrying an Offer with
 * `price` and `priceCurrency`. GOG does — and its visible price element holds a
 * bare "17.99" with the currency rendered somewhere else entirely, so the CSS
 * route reads a number it cannot name, and a number we cannot name is not a
 * price. Structured data is the page stating the same fact in a form published
 * to be read, which makes it both steadier than a class name and more clearly
 * not scraping.
 *
 * Only ever used to fill what the DOM left out: it can carry a default-region
 * figure rather than the one on screen, and what the user is looking at wins.
 */
export function readPublishedOffer(root: ParentNode = document): { price: number; currency: string } | null {
  for (const tag of root.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(tag.textContent ?? '');
    } catch {
      continue;
    }
    // A page may publish a single object, a list, or a @graph.
    const candidates = Array.isArray(data)
      ? data
      : [data, ...((data as { '@graph'?: unknown[] })?.['@graph'] ?? [])];
    for (const node of candidates) {
      const offers = (node as { offers?: unknown })?.offers;
      const offer = (Array.isArray(offers) ? offers[0] : offers) as
        | { price?: unknown; priceCurrency?: unknown }
        | undefined;
      if (!offer) continue;
      const price = Number(offer.price);
      const currency = typeof offer.priceCurrency === 'string' ? offer.priceCurrency.trim().toUpperCase() : null;
      if (Number.isFinite(price) && price > 0 && currency) return { price, currency };
    }
  }
  return null;
}

/**
 * Store titles carry a lot that is not the game's name.
 *
 * "Buy Cyberpunk 2077 | Xbox" and "Save 50% on ELDEN RING on Steam" are the
 * page title; the search wants the game. Store suffixes, the "buy"/"save"
 * furniture and the trademark marks all come off — the same normalisation the
 * server does to catalogue titles, applied at the door instead.
 */
export function cleanPageTitle(raw: string): string {
  return raw
    .replace(/\s*[|·—–-]\s*(Steam|GOG\.com|GOG|Xbox|PlayStation|Nintendo|Epic Games Store|Epic Games).*$/i, '')
    // A leading discount badge: GOG's own title is "-70% Cyberpunk 2077 | GOG.com".
    .replace(/^\s*-?\d+%\s*/, '')
    .replace(/^\s*(Buy|Save\s+\d+%\s+on|Get)\s+/i, '')
    .replace(/\s+on\s+(Steam|GOG\.com|GOG|Xbox|PlayStation|Nintendo)\s*$/i, '')
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every storefront we can identify a game on, and how. */
const STORES: {
  id: StorePage['store'];
  name: string;
  /** True when this URL is a product page (not a search, a library, a home page). */
  matches(url: URL): boolean;
  titleSelectors: string[];
  /** The block holding this game's own price, searched before the price is. */
  containerSelectors: string[];
  priceSelectors: string[];
}[] = [
  {
    id: 'steam',
    name: 'Steam',
    matches: (u) => /(^|\.)steampowered\.com$/.test(u.hostname) && /^\/app\/\d+/.test(u.pathname),
    titleSelectors: ['#appHubAppName', '.apphub_AppName', 'div.page_title_area .apphub_AppName'],
    // The FIRST purchase block is the base game; the ones after it are bundles
    // and other editions. See priceRoot for what happens without this.
    containerSelectors: ['.game_area_purchase_game_wrapper', '.game_area_purchase_game'],
    priceSelectors: ['.discount_final_price', '.game_purchase_price'],
  },
  {
    id: 'gog',
    name: 'GOG',
    matches: (u) => /(^|\.)gog\.com$/.test(u.hostname) && /\/game\//.test(u.pathname),
    titleSelectors: ['h1.productcard-basics__title', '.productcard-basics__title', 'h1[itemprop="name"]', 'h1'],
    containerSelectors: ['.product-actions', '.productcard-basics'],
    priceSelectors: ['.product-actions-price__final-amount', '[selenium-id="ProductFinalPrice"]', '.product-actions-price'],
  },
  {
    id: 'xbox',
    name: 'Xbox',
    matches: (u) => /(^|\.)xbox\.com$/.test(u.hostname) && /\/games\/store\//.test(u.pathname),
    titleSelectors: ['h1[class*="ProductTitle"]', 'h1[class*="Title"]', 'h1'],
    containerSelectors: ['[class*="AcquisitionButtons"]', '[class*="ProductDetailsHeader"]'],
    priceSelectors: ['[class*="Price-module"] span', '[data-testid="Price"]', '[class*="AcquisitionButton"] span'],
  },
  {
    id: 'playstation',
    name: 'PlayStation Store',
    matches: (u) => /(^|\.)playstation\.com$/.test(u.hostname) && /\/product\//.test(u.pathname),
    titleSelectors: ['h1[data-qa="mfe-game-title#name"]', 'h1[data-qa*="game-title"]', 'h1'],
    containerSelectors: ['[data-qa*="mfeCtaMain"]', '[data-qa*="ctaWithPrice"]'],
    priceSelectors: ['[data-qa*="finalPrice"]', 'span[data-qa*="price"]'],
  },
  {
    id: 'nintendo',
    name: 'Nintendo eShop',
    matches: (u) => /(^|\.)nintendo\.com$/.test(u.hostname) && /\/store\/products\//.test(u.pathname),
    titleSelectors: ['h1[class*="heading"]', 'h1'],
    containerSelectors: ['[class*="BuyButton"]', '[class*="ProductHero"]'],
    priceSelectors: ['[class*="Price"] span', 'span[class*="price"]'],
  },
  {
    id: 'epic',
    name: 'Epic Games Store',
    matches: (u) => /(^|\.)epicgames\.com$/.test(u.hostname) && /\/(p|product)\//.test(u.pathname),
    titleSelectors: ['h1[data-testid="pdp-title"]', 'h1 span', 'h1'],
    containerSelectors: ['[data-testid="purchase-cta-button"]', '[data-component="PurchaseCTA"]'],
    priceSelectors: ['span[class*="Price"]', 'span'],
  },
];

/**
 * What this page is selling, or null when it is not a product page we can read.
 *
 * The title is required and the price is not: knowing which game you are looking
 * at is enough to compare, and a store whose markup moved should degrade to a
 * comparison without its own price rather than to no panel at all.
 */
export function readStorePage(href: string = location.href): StorePage | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const store = STORES.find((s) => s.matches(url));
  if (!store) return null;

  // The page's own heading first; document.title as the fallback, since every
  // one of these stores dresses it up differently and cleanPageTitle knows how.
  const heading = firstText(store.titleSelectors);
  const title = cleanPageTitle(heading ?? document.title ?? '');
  // Two characters is not a game name; it is a partly-rendered page.
  if (title.length < 3) return null;

  // What the page SHOWS, first — that is the price the person is looking at.
  const priceText = firstText(store.priceSelectors, priceRoot(store.containerSelectors));
  const shownAmount = priceText ? parseAmount(priceText) : null;
  const shownCurrency = priceText ? parseCurrency(priceText) : null;
  // What the page PUBLISHES, only for what the DOM left out. GOG's price element
  // is a bare "17.99" with the currency rendered elsewhere, and without this the
  // amount is unusable.
  const published = shownAmount !== null && shownCurrency ? null : readPublishedOffer();

  const price = shownAmount ?? published?.price ?? null;
  const currency = shownCurrency ?? published?.currency ?? null;
  // Never one without the other. An amount we cannot name cannot be compared
  // against anything, and assuming it is shekels would invent a saving.
  const usable = price !== null && currency !== null;

  return {
    store: store.id,
    storeName: store.name,
    title,
    price: usable ? price : undefined,
    currency: usable ? currency : undefined,
  };
}
