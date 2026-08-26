/**
 * Track an Amazon listing's price, from the page you are already looking at.
 *
 * WHAT THIS IS, AND WHAT IT REFUSES TO BE.
 *
 * The project's first rule is that it does not bypass bot protection, and that
 * rule is why six Israeli retailers are unsupported rather than half-scraped.
 * Amazon is the same case: it does not want to be crawled, and this does not
 * crawl it. There is no background fetching, no search-Amazon-for-me, no
 * request this extension makes to Amazon at all.
 *
 * What it does is read the page the user themselves opened, in their own
 * browser, and offer to remember the number that is already on their screen —
 * the same thing a person would do by typing it into a spreadsheet. Nothing is
 * sent anywhere: the tool has no server, so the price lands in the user's own
 * local history beside everything else they track.
 *
 * The consequences are honest and worth stating: prices only update for pages
 * the user visits again, and there is no way to search Amazon from the app.
 * That is the cost of not crawling, and it is the correct cost.
 *
 * Nothing appears unless a price is actually found, and the card can be
 * dismissed for the session. An extension that plants a panel on every page it
 * is allowed to see is one people uninstall.
 */

/** Amazon prints the price in several shapes; these are the containers it uses. */
const PRICE_SELECTORS = [
  '#corePrice_feature_div .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-offscreen',
  '#price_inside_buybox',
  '#newBuyBoxPrice',
  '.priceToPay .a-offscreen',
  '#tp_price_block_total_price_ww .a-offscreen',
];

const TITLE_SELECTORS = ['#productTitle', '#title span', 'h1 span.a-text-normal'];

/**
 * What Amazon PRINTS about delivery, on the page, in one sentence.
 *
 * For an Israeli address the product page states both facts outright:
 *
 *     "No Import Charges & $15.66 Shipping to Israel"
 *
 * So there is nothing to estimate and no percentage to apply. Both numbers are
 * published, and "No Import Charges" is itself a statement — zero because Amazon
 * says zero, not because we assumed it. Where the sentence is absent we record
 * the item price alone and say the delivered cost is unknown; we never fill the
 * gap with arithmetic.
 */
const DELIVERY_SELECTORS = [
  '#amazonGlobal_feature_div',
  '#globalStoreBadgePopoverInsideBuybox_feature_div',
  '#priceBadging_feature_div',
  '#deliveryBlockMessage',
  '#mir-layout-DELIVERY_BLOCK',
];

export interface DeliveryCosts {
  /** Import charges as stated. 0 when the page says "No Import Charges". */
  importFees?: number;
  /** Shipping as stated. 0 when the page says FREE. */
  shipping?: number;
  currency?: string;
}

/**
 * Read the delivery sentence. Anything it does not state stays undefined —
 * absent is "the page did not say", which is not the same as zero.
 */
export function parseDeliveryLine(text: string): DeliveryCosts {
  const flat = text.replace(/\s+/g, ' ');
  if (!/shipping to/i.test(flat)) return {};
  const out: DeliveryCosts = {};

  const importMatch = flat.match(/(?:No|Free)\s+Import\s+(?:Charges|Fees)/i);
  if (importMatch) out.importFees = 0;
  else {
    const paid = flat.match(/([₪$£€]\s?[\d.,]+)\s*(?:Import\s+(?:Charges|Fees)|Import\s+Fees\s+Deposit)/i);
    const parsed = paid ? parsePrice(paid[1]!) : null;
    if (parsed) {
      out.importFees = parsed.price;
      out.currency = parsed.currency;
    }
  }

  const freeShip = /(?:&|and)\s*FREE\s+Shipping/i.test(flat);
  if (freeShip) out.shipping = 0;
  else {
    const ship = flat.match(/([₪$£€]\s?[\d.,]+)\s*Shipping\s+to/i);
    const parsed = ship ? parsePrice(ship[1]!) : null;
    if (parsed) {
      out.shipping = parsed.price;
      out.currency ??= parsed.currency;
    }
  }
  return out;
}

export interface AmazonListing {
  title: string;
  price: number;
  currency: string;
  url: string;
  /** The ASIN, so re-visiting the same product updates one row rather than adding one. */
  asin: string;
  /**
   * Import charges and shipping AS PRINTED by Amazon. Absent means the page did
   * not say — never that they are zero. Zero means the page said zero.
   */
  importFees?: number;
  shipping?: number;
}

/**
 * Read a displayed price like "₪189.90", "$59.99" or "£49.99".
 *
 * Deliberately strict about what counts as a number: Amazon pages are full of
 * digits (ratings, review counts, "3 offers from"), and a loose parse would
 * happily record a star rating as a price.
 */
export function parsePrice(text: string): { price: number; currency: string } | null {
  const cleaned = text.replace(/\s|‎|‏/g, '');
  const symbol = cleaned.match(/[₪$£€¥]|R\$|CA\$|A\$/)?.[0];
  const code = cleaned.match(/\b(ILS|USD|GBP|EUR|JPY|CAD|AUD|PLN|SEK)\b/)?.[1];
  const currency =
    code ??
    ({ '₪': 'ILS', $: 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', 'R$': 'BRL', 'CA$': 'CAD', 'A$': 'AUD' }[
      symbol ?? ''
    ] ??
      null);
  if (!currency) return null;

  // 1.234,56 (European) vs 1,234.56 (Anglo): the LAST separator is the decimal
  // one. Getting this backwards turns €1.234 into €1.23.
  const digits = cleaned.match(/\d[\d.,]*/)?.[0];
  if (!digits) return null;
  const lastDot = digits.lastIndexOf('.');
  const lastComma = digits.lastIndexOf(',');
  let normalised: string;
  if (lastDot === -1 && lastComma === -1) normalised = digits;
  else if (lastComma > lastDot) normalised = digits.replace(/\./g, '').replace(',', '.');
  else normalised = digits.replace(/,/g, '');

  const price = Number(normalised);
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price, currency };
}

const firstText = (selectors: string[]): string | null => {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return null;
};

/** The ASIN out of the URL or the page, or null when this is not a product page. */
export function readAsin(url: string, dom?: { querySelector(s: string): Element | null }): string | null {
  const fromUrl = url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i)?.[1];
  if (fromUrl) return fromUrl.toUpperCase();
  // Resolved lazily, not as a default parameter: `dom = document` is evaluated
  // on every call that omits it, which throws anywhere without a DOM — the URL
  // form above needs no document at all.
  const root = dom ?? (typeof document === 'undefined' ? null : document);
  if (!root) return null;
  const input = root.querySelector('input#ASIN, input[name="ASIN"]') as HTMLInputElement | null;
  const value = input?.value?.trim();
  return value && /^[A-Z0-9]{10}$/i.test(value) ? value.toUpperCase() : null;
}

/** What this page is selling, or null when it is not a product page we can read. */
export function readListing(): AmazonListing | null {
  const asin = readAsin(location.href);
  if (!asin) return null;
  const title = firstText(TITLE_SELECTORS);
  if (!title) return null;
  const priceText = firstText(PRICE_SELECTORS);
  if (!priceText) return null;
  const parsed = parsePrice(priceText);
  if (!parsed) return null;
  // The delivery sentence, from its usual containers or — since Amazon moves it
  // between layouts — from the page text as a last resort. The pattern is
  // specific enough ("Import Charges" next to "Shipping to") that a false match
  // is not a realistic worry.
  let delivery = parseDeliveryLine(firstText(DELIVERY_SELECTORS) ?? '');
  if (delivery.shipping === undefined && delivery.importFees === undefined) {
    // Split into lines rather than writing a newline into a pattern: the
    // sentence always lives on one line, and a line-by-line scan says so
    // plainly.
    const lines = (document.body?.innerText ?? '').split('\n');
    const line = lines.find((l) => /Import\s+(?:Charges|Fees)/i.test(l) && /Shipping\s+to/i.test(l));
    if (line) delivery = parseDeliveryLine(line);
  }
  // A figure quoted in another currency is dropped rather than added: a total
  // mixing two currencies would be a number that exists nowhere.
  if (delivery.currency && delivery.currency !== parsed.currency) delivery = {};

  return {
    title,
    price: parsed.price,
    currency: parsed.currency,
    // Canonical, without the tracking and session junk Amazon appends.
    url: `${location.origin}/dp/${asin}`,
    asin,
    importFees: delivery.importFees,
    shipping: delivery.shipping,
  };
}
