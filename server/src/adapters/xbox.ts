import type { GameHit, Offer, SourceAdapter, SourceOffers } from './types.ts';
import { inclusionsFor } from './gamepass.ts';
import { toILS, canConvert } from '../rates.ts';
import { REGIONS } from '../regions.ts';
import { describeProduct } from '../normalize.ts';

/**
 * Xbox / Microsoft Store — regional price board.
 *
 * Uses Microsoft's OWN public catalog API (displaycatalog.mp.microsoft.com),
 * the same service the Store app calls. No scraping, no bot-protection to
 * work around: `market=XX` yields that region's official price. We fetch a
 * game's price in every configured region and convert each to ₪.
 *
 * sourceGameId = Microsoft Store ProductId (e.g. "9NKX70BBCDRN").
 */

const CATALOG = 'https://displaycatalog.mp.microsoft.com/v7.0';

interface SuggestProduct {
  ProductId: string;
  Title: string;
  Type: string;
  Icon?: string;
}

interface CatalogPrice {
  ListPrice?: number;
  MSRP?: number;
  CurrencyCode?: string;
}

/** Per-(product,market) price cache — official API, but no need to re-ask within a session. */
const priceCache = new Map<string, { price: CatalogPrice | null; at: number }>();
const PRICE_TTL = 30 * 60 * 1000;

function icon(url?: string): string | undefined {
  if (!url) return undefined;
  return url.startsWith('//') ? 'https:' + url : url;
}

async function fetchMarketPrice(productId: string, market: string): Promise<CatalogPrice | null> {
  const key = `${productId}@${market}`;
  const hit = priceCache.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL) return hit.price;

  const url = `${CATALOG}/products/${productId}?market=${market}&languages=en-US&fieldsTemplate=Details`;
  let price: CatalogPrice | null = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const data = (await res.json()) as {
        Product?: { DisplaySkuAvailabilities?: Array<{ Availabilities?: Array<{ OrderManagementData?: { Price?: CatalogPrice } }> }> };
      };
      const avails = data.Product?.DisplaySkuAvailabilities ?? [];
      for (const sku of avails) {
        for (const av of sku.Availabilities ?? []) {
          const p = av.OrderManagementData?.Price;
          // A real purchasable price has a currency and a non-zero MSRP.
          if (p?.CurrencyCode && (p.MSRP ?? 0) > 0) {
            price = p;
            break;
          }
        }
        if (price) break;
      }
    }
  } catch {
    price = null;
  }
  priceCache.set(key, { price, at: Date.now() });
  return price;
}

export const xbox: SourceAdapter = {
  id: 'xbox-store',
  name: 'Xbox Store (regional)',
  nameHe: 'חנות אקסבוקס — לפי אזור',
  platforms: ['xbox'],
  enabled: true,

  async search(title: string): Promise<GameHit[]> {
    const url = `${CATALOG}/productFamilies/autosuggest?query=${encodeURIComponent(
      title
    )}&market=US&languages=en-US&productFamilyNames=Games`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`xbox autosuggest ${res.status}`);
    const data = (await res.json()) as { Results?: Array<{ Products?: SuggestProduct[] }> };

    const products = data.Results?.flatMap((r) => r.Products ?? []) ?? [];
    const hits: GameHit[] = [];
    for (const p of products) {
      if (p.Type !== 'Game') continue;
      const d = describeProduct(p.Title);
      if (d.accessory) continue;
      hits.push({
        sourceId: 'xbox-store',
        sourceGameId: p.ProductId,
        title: d.base || p.Title,
        groupKey: d.groupKey,
        edition: d.edition,
        image: icon(p.Icon),
        platform: 'xbox',
      });
    }
    return hits;
  },

  /** Returns one offer per region (price board), cheapest ₪ first, pinned regions flagged. */
  async getOffers(sourceGameId: string): Promise<SourceOffers> {
    // Asked alongside the regional prices, not after them: it is one cached
    // set lookup and must never add a step to how long the board takes.
    const included = inclusionsFor(sourceGameId);
    const results = await Promise.all(
      REGIONS.map(async (region) => {
        const price = await fetchMarketPrice(sourceGameId, region.market);
        if (!price?.CurrencyCode) return null;
        const native = price.ListPrice ?? price.MSRP ?? 0;
        if (native <= 0) return null; // free/unavailable in this region
        if (!(await canConvert(price.CurrencyCode))) return null;
        const msrp = price.MSRP ?? native;
        const offer: Offer = {
          store: `Xbox ${region.flag}`,
          kind: 'digital',
          location: region.market === 'IL' ? 'israel' : 'international',
          price: native,
          currency: price.CurrencyCode,
          priceILS: await toILS(native, price.CurrencyCode),
          retailPrice: msrp > native ? msrp : undefined,
          savings: msrp > native ? Math.round(((msrp - native) / msrp) * 100) : undefined,
          region: region.market,
          regionName: region.nameHe,
          flag: region.flag,
          pinned: region.pinned,
          url: `https://www.xbox.com/en-${region.market.toLowerCase()}/games/store/-/${sourceGameId}`,
        };
        return offer;
      })
    );

    const offers = results.filter((o): o is Offer => o !== null);
    offers.sort((a, b) => a.priceILS - b.priceILS);
    return { offers, includedIn: await included };
  },
};
