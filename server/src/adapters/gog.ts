import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { describeProduct, groupKey } from '../normalize.ts';
import { toILS, canConvert } from '../rates.ts';
import { REGIONS } from '../regions.ts';

/**
 * GOG.com — DRM-free PC storefront, priced per region.
 *
 * GOG already appeared in results through CheapShark, but only as whatever GOG
 * listing CheapShark happened to be tracking, at one price, with no region. That
 * is a footnote, not coverage: measured here, Cyberpunk 2077 is $17.99 from
 * Israel and $13.49 from Turkey — a 25% gap of exactly the kind this tool exists
 * to show, and it was invisible.
 *
 * WHY THIS IS A NORMAL API CALL AND NOT SCRAPING. catalog.gog.com is the JSON
 * API GOG's own storefront runs on; we ask it the same questions in the same way
 * and read the answer. Their robots.txt disallows /upload/, /www/,
 * /downloader2/, /galaxy_notifications/, /unsubscribe/ and /profile — nothing
 * near this. Like Steam, Epic, PSN and Xbox, it therefore uses a plain fetch
 * with a small concurrency cap rather than politeFetch, which exists to protect
 * small shops whose HTML we parse.
 *
 * THE CATALOG QUOTES USD FOR EVERY REGION. Turkey is not cheaper lira, it is
 * fewer dollars: base $44.99 there against $59.99 in Israel. Confirmed against a
 * second, independent endpoint (api.gog.com/products/{id}/prices), which returns
 * the same figures — and which also shows the fuller picture: some markets carry
 * a local-currency price ALONGSIDE the dollar one (South Africa quotes both
 * $82.39 and R799). They are the same money, so reading the dollar figure gives
 * the right shekel amount either way. The currency is still read off the response
 * rather than assumed from the region, because that assumption is the one that
 * would silently misconvert a whole market.
 *
 * WHAT THE CHEAP ROW DOES NOT MEAN: that an Israeli can pay it. GOG prices by
 * the account's country, so the Ukrainian figure needs a Ukrainian account and
 * payment method. Rows carry the board's "חשבון זר" badge for exactly this — see
 * web/src/regionRisk.ts — which is what keeps a real price from being a false
 * promise.
 */

const CATALOG = 'https://catalog.gog.com/v1/catalog';
const UA = 'GamePriceIL/0.1 (personal wishlist price tracker for Israel)';
const CACHE_TTL = 10 * 60 * 1000;
/** GOG is one host; this is the same shape of cap the Steam adapter uses. */
const MAX_CONCURRENT = 4;
const SEARCH_LIMIT = 20;

/** GOG serves these markets from the shared roster; the rest are skipped silently. */
const SUPPORTED = new Set([
  'IL', 'US', 'TR', 'AR', 'IN', 'UA', 'BR', 'KZ', 'ZA', 'MX',
  'GB', 'DE', 'FR', 'PL', 'CA', 'AU', 'JP', 'KR', 'CN', 'RU',
  'CL', 'CO', 'PE', 'TH', 'ID', 'MY', 'SG', 'PH', 'VN', 'SA', 'HK', 'TW',
]);
const GOG_REGIONS = REGIONS.filter((r) => SUPPORTED.has(r.market));

interface CatalogPrice {
  final?: string;
  base?: string;
  discount?: string;
  finalMoney?: { amount?: string; currency?: string };
  baseMoney?: { amount?: string; currency?: string };
}

interface CatalogProduct {
  id?: string;
  slug?: string;
  title?: string;
  productType?: string;
  coverHorizontal?: string;
  storeLink?: string;
  price?: CatalogPrice;
}

const cache = new Map<string, { products: CatalogProduct[]; at: number }>();

/** One catalog query. Returns [] on any failure — one region must not sink a board. */
async function catalog(query: string, country: string): Promise<CatalogProduct[]> {
  const url =
    `${CATALOG}?limit=${SEARCH_LIMIT}&query=${encodeURIComponent(`like:${query}`)}` +
    `&order=desc%3Ascore&productType=in%3Agame%2Cpack%2Cdlc&page=1&countryCode=${country}&locale=en-US`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.products;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { products?: CatalogProduct[] };
    const products = data.products ?? [];
    cache.set(url, { products, at: Date.now() });
    return products;
  } catch {
    return [];
  }
}

/** Run region lookups with a small concurrency cap. */
async function pooled<T, R>(items: T[], fn: (t: T) => Promise<R>, limit = MAX_CONCURRENT): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * GOG's cover URLs end mid-hash with no extension — the storefront appends a
 * size suffix at render time. Without one the browser gets nothing.
 */
function coverUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith('http') ? `${raw}.jpg` : undefined;
}

const money = (m: { amount?: string; currency?: string } | undefined) => {
  const amount = Number(m?.amount);
  return Number.isFinite(amount) && amount > 0 ? { amount, currency: m?.currency || 'USD' } : null;
};

/**
 * sourceGameId = "<product id>~<url-encoded title>".
 *
 * The catalog API has no lookup-by-id, so pricing a game per region means asking
 * each region's catalog for the title again and picking the row with this id.
 * Carrying the title avoids a second call just to learn what to search for.
 */
export const gog: SourceAdapter = {
  id: 'gog',
  name: 'GOG.com',
  nameHe: 'GOG — לפי אזור',
  platforms: ['pc'],
  // GOG is DRM-free-only, so it does not stock the canary's default title and
  // "no results" there would mean nothing. Probe with something it does carry.
  healthProbe: 'Cyberpunk 2077',
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
    if (platforms.length && !platforms.includes('pc')) return [];
    // Add-ons are requested deliberately even though the fan-out will usually
    // filter them out. GOG is one of the few sources that CLASSIFIES them, and
    // that label is worth more than the listing: it is what lets the fan-out
    // recognise "Cyberpunk 2077: Phantom Liberty" as an add-on in the stores
    // that sell it as an ordinary product. See markKnownAddOns in fanout.ts.
    // One neutral region for discovery; prices come later, per region.
    const products = await catalog(title, 'IL');

    const hits: GameHit[] = [];
    const seen = new Set<string>();
    for (const p of products) {
      if (!p.id || !p.title) continue;
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const described = describeProduct(p.title);
      // GOG labels add-ons itself; trust that as well as our own title reading.
      const dlc = described.dlc || p.productType === 'dlc' || p.productType === 'extras';
      if (described.accessory) continue;
      hits.push({
        sourceId: 'gog',
        sourceGameId: `${p.id}~${encodeURIComponent(p.title)}`,
        title: described.base,
        groupKey: groupKey(described.base),
        edition: described.edition,
        image: coverUrl(p.coverHorizontal),
        platform: 'pc',
        dlc,
      });
    }
    return hits;
  },

  async getOffers(sourceGameId: string): Promise<Offer[]> {
    const [id, encoded] = sourceGameId.split('~');
    const title = decodeURIComponent(encoded ?? '');
    if (!id || !title) return [];

    const rows = await pooled(GOG_REGIONS, async (region) => {
      const products = await catalog(title, region.market);
      const found = products.find((p) => p.id === id);
      const final = money(found?.price?.finalMoney);
      if (!final) return null;
      // A region that does not sell it, or prices it in something we have no
      // rate for, is skipped rather than guessed at.
      if (!(await canConvert(final.currency))) return null;

      const base = money(found?.price?.baseMoney);
      const offer: Offer = {
        store: `GOG ${region.flag}`,
        kind: 'digital',
        location: 'international',
        price: final.amount,
        currency: final.currency,
        priceILS: await toILS(final.amount, final.currency),
        region: region.market,
        regionName: region.nameHe,
        flag: region.flag,
        pinned: region.pinned,
        url: found?.storeLink,
      };
      if (base && base.amount > final.amount) {
        offer.retailPrice = base.amount;
        offer.savings = Math.round(((base.amount - final.amount) / base.amount) * 100);
      }
      return offer;
    });

    return rows.filter((o): o is Offer => o !== null);
  },
};
