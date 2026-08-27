import { CHEAPSHARK_HEADERS } from './adapters/cheapshark.ts';
import { toILS } from './rates.ts';
import { groupKey } from './normalize.ts';

/**
 * Today's deals, from every feed that publishes one.
 *
 * THREE SOURCES, ALL PUBLISHED APIS. Not one of them is scraped — CheapShark
 * publishes a JSON API and opts into cross-origin use, Steam's storefront has a
 * `featuredcategories` endpoint the store page itself calls, and GOG's catalogue
 * takes a `discounted` filter. These are the calls in this whole tool that touch
 * no shop's HTML at all.
 *
 * They each answer a different question, which is why one was not enough:
 *
 *   CheapShark ranks by its own "Deal Rating" across dozens of PC shops, and
 *   demands a real Metacritic and Steam score, so it surfaces games people have
 *   heard of rather than $1 shovelware at 95% off.
 *
 *   Steam's specials are the ones actually on the Israeli front page, priced in
 *   SHEKELS by Steam itself — no conversion, no guessing, the number an Israeli
 *   buyer will be charged.
 *
 *   GOG's catalogue is nearly four thousand discounted titles deep, which is
 *   what makes a deals page you can keep scrolling possible at all.
 *
 * Every source is asked for the same page number in parallel and the results are
 * merged, so scrolling costs one round of requests rather than one per source
 * per screen. A source that fails contributes nothing and the page still fills.
 */

export interface TickerDeal {
  title: string;
  /** In ₪. Converted where the source does not quote shekels; never rounded to whole. */
  salePrice: number;
  normalPrice: number;
  savings: number;
  /** Steam's positive-review percentage, when the source carries it. */
  rating?: number;
  /**
   * Which feed this came from, and the shop it belongs to.
   *
   * Added because a price with no attribution is not a price — the deals page
   * shows a number and, before this, no way to know whose number it was.
   */
  source?: 'cheapshark' | 'steam' | 'gog';
  storeName?: string;
}

/** The strip shows fifteen; the deals page asks for more and keeps asking. */
const DEFAULT_LIMIT = 15;
const HARD_MAX = 60;

const HEADERS = {
  'User-Agent': 'GamePriceIL/0.1 (personal game price tracker; noron10@gmail.com)',
};

/* ── CheapShark ──────────────────────────────────────────────────────────── */

interface RawCheapShark {
  title: string;
  salePrice: string;
  normalPrice: string;
  savings: string;
  steamRatingPercent?: string;
}

async function cheapsharkDeals(page: number, size: number): Promise<TickerDeal[]> {
  const url =
    'https://www.cheapshark.com/api/1.0/deals?sortBy=Deal%20Rating&metacritic=75&steamRating=80&onSale=1' +
    `&pageSize=${size}&pageNumber=${page}`;
  const res = await fetch(url, { headers: CHEAPSHARK_HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const raw = (await res.json()) as RawCheapShark[];

  const out: TickerDeal[] = [];
  for (const d of raw) {
    const saleUsd = Number(d.salePrice);
    const normalUsd = Number(d.normalPrice);
    // Both must be real numbers: an unparseable normalPrice reaches the client
    // as JSON null and renders a blank "was" beside a valid "now".
    if (!Number.isFinite(saleUsd) || saleUsd <= 0) continue;
    if (!Number.isFinite(normalUsd) || normalUsd <= 0) continue;
    out.push({
      title: d.title,
      // Agorot kept. Rounding to whole shekels distorted what the user sees:
      // $0.99 → ₪3 → back to $0.98 once the client formats it in dollars.
      salePrice: await toILS(saleUsd, 'USD'),
      normalPrice: await toILS(normalUsd, 'USD'),
      savings: Math.round(Number(d.savings)),
      rating: d.steamRatingPercent ? Number(d.steamRatingPercent) : undefined,
      source: 'cheapshark',
      storeName: 'CheapShark',
    });
  }
  return out;
}

/* ── Steam's own Israeli specials ────────────────────────────────────────── */

interface RawSteamSpecial {
  name?: string;
  discount_percent?: number;
  final_price?: number;
  original_price?: number;
  currency?: string;
}

/**
 * The specials Steam itself puts on the Israeli front page.
 *
 * Prices arrive in the smallest unit — 1798 means ₪17.98 — and already in
 * shekels, so this is the one feed here that needs no conversion at all. It is
 * a single fixed list rather than a paginated one, so it contributes to the
 * first page and nothing after it.
 */
async function steamSpecials(): Promise<TickerDeal[]> {
  const res = await fetch('https://store.steampowered.com/api/featuredcategories?cc=IL&l=en', {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { specials?: { items?: RawSteamSpecial[] } };
  const items = body.specials?.items ?? [];

  const out: TickerDeal[] = [];
  for (const item of items) {
    const title = item.name?.trim();
    const final = Number(item.final_price);
    const original = Number(item.original_price);
    if (!title || !Number.isFinite(final) || final <= 0) continue;
    // A currency other than ILS would mean Steam answered for a different
    // market; converting it would quietly show a price this buyer cannot get.
    if (item.currency && item.currency.toUpperCase() !== 'ILS') continue;
    const sale = final / 100;
    const normal = Number.isFinite(original) && original > final ? original / 100 : sale;
    out.push({
      title,
      salePrice: sale,
      normalPrice: normal,
      savings: Math.round(Number(item.discount_percent) || 0),
      source: 'steam',
      storeName: 'Steam',
    });
  }
  return out;
}

/* ── GOG's discounted catalogue ──────────────────────────────────────────── */

interface RawGogProduct {
  title?: string;
  price?: {
    discount?: string;
    finalMoney?: { amount?: string; currency?: string };
    baseMoney?: { amount?: string; currency?: string };
  };
}

/**
 * GOG's discounted catalogue — nearly four thousand titles deep.
 *
 * This is what makes a deals page worth scrolling. GOG bills Israeli customers
 * in dollars, so the amounts come back in USD however the request is phrased,
 * and are converted here like every other foreign price in the tool.
 */
async function gogDeals(page: number, size: number): Promise<TickerDeal[]> {
  const url =
    'https://catalog.gog.com/v1/catalog?order=desc%3Atrending&discounted=eq%3Atrue' +
    `&productType=in%3Agame&countryCode=IL&locale=en-US&limit=${size}&page=${page + 1}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { products?: RawGogProduct[] };

  const out: TickerDeal[] = [];
  for (const product of body.products ?? []) {
    const title = product.title?.trim();
    const final = Number(product.price?.finalMoney?.amount);
    const base = Number(product.price?.baseMoney?.amount);
    const currency = product.price?.finalMoney?.currency?.trim() || 'USD';
    if (!title || !Number.isFinite(final) || final <= 0) continue;
    // Free is not a deal here — it is a giveaway, and it sorts to the top of
    // everything forever while telling nobody anything about prices.
    if (!Number.isFinite(base) || base <= final) continue;
    try {
      out.push({
        title,
        salePrice: await toILS(final, currency),
        normalPrice: await toILS(base, currency),
        savings: Math.round(((base - final) / base) * 100),
        source: 'gog',
        storeName: 'GOG',
      });
    } catch {
      // A currency we cannot convert today is skipped rather than shown raw.
    }
  }
  return out;
}

/* ── Merged ──────────────────────────────────────────────────────────────── */

/**
 * One game, once.
 *
 * The same title appears across feeds — and inside CheapShark once per shop —
 * so they collapse on the normalised key the rest of the tool already groups by,
 * keeping whichever is actually cheapest. Without this, page two of the deals
 * page is largely page one again.
 */
function dedupe(deals: TickerDeal[]): TickerDeal[] {
  const best = new Map<string, TickerDeal>();
  for (const deal of deals) {
    const key = groupKey(deal.title);
    const seen = best.get(key);
    if (!seen || deal.salePrice < seen.salePrice) best.set(key, deal);
  }
  return [...best.values()];
}

/**
 * A page of deals, merged across every feed.
 *
 * Never throws and never returns a half-answer: each source is wrapped so one
 * being down costs its rows and nothing else. An empty page is a quiet screen;
 * a thrown one is a broken app.
 */
export async function dealsPage(page = 0, limit = DEFAULT_LIMIT): Promise<TickerDeal[]> {
  const size = Math.min(Math.max(1, limit), HARD_MAX);
  const perSource = Math.max(8, Math.ceil(size / 2));

  const safely = async (work: Promise<TickerDeal[]>): Promise<TickerDeal[]> => {
    try {
      return await work;
    } catch {
      return [];
    }
  };

  const [cheap, steam, gog] = await Promise.all([
    safely(cheapsharkDeals(page, perSource)),
    // Steam's specials are one fixed list, so they belong to the first page
    // only — repeating them under every scroll would be padding, not deals.
    page === 0 ? safely(steamSpecials()) : Promise.resolve([]),
    safely(gogDeals(page, perSource)),
  ]);

  // Biggest discount first. Every feed is already filtered for quality in its
  // own way, so this is only about which of the survivors leads.
  return dedupe([...steam, ...cheap, ...gog])
    .sort((a, b) => b.savings - a.savings)
    .slice(0, size);
}

/** The strip at the top of every screen: the first page, nothing more. */
export async function tickerDeals(limit = DEFAULT_LIMIT): Promise<TickerDeal[]> {
  return dealsPage(0, limit);
}
