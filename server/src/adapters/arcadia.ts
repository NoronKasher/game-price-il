import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { politeFetch } from './politeFetch.ts';
import { describeProduct, looksDigital, parseNis, titleMatchesQuery } from '../normalize.ts';
import { wooSearch } from './wooStore.ts';

/**
 * Arcadia (arcadia.co.il) — Israeli gaming chain, running WooCommerce.
 *
 * Reads the shop's public Store API (JSON: exact price in minor units, stock,
 * permalink) and falls back to parsing the "rt-" theme's server-rendered tiles
 * if that API ever goes away. The platform is embedded in the product title
 * ("PS4 Elden Ring…"). sourceGameId = product page URL.
 */

const offerCache = new Map<string, Offer>();

function makeOffer(title: string, price: number, url: string): Offer {
  return {
    store: 'Arcadia',
    kind: looksDigital(title) ? 'digital' : 'physical',
    location: 'israel',
    price,
    currency: 'ILS',
    priceILS: price,
    url,
  };
}

/**
 * The Store API path. Returns null when the shop doesn't answer it, so `search`
 * drops back to scraping rather than reporting the store as empty.
 */
async function searchViaStoreApi(title: string, platforms: Platform[]): Promise<GameHit[] | null> {
  const products = await wooSearch('https://arcadia.co.il', title);
  if (!products) return null;
  const hits: GameHit[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    if (seen.has(p.url)) continue;
    // The shop search matches descriptions and tags too, so drop products whose
    // name has nothing to do with the query (repair services, other games).
    if (!titleMatchesQuery(title, p.name)) continue;
    const d = describeProduct(p.name);
    if (d.accessory) continue;
    const platform = d.platforms[0];
    // Physical shops sell console discs; a "pc" match here is a gaming PC.
    if (!platform || platform === 'pc') continue;
    if (platforms.length && !platforms.includes(platform)) continue;
    seen.add(p.url);

    const offer = makeOffer(p.name, p.price, p.url);
    if (p.regularPrice != null) {
      offer.retailPrice = p.regularPrice;
      offer.savings = Math.round(((p.regularPrice - p.price) / p.regularPrice) * 100);
    }
    offerCache.set(p.url, offer);
    hits.push({
      sourceId: 'arcadia',
      sourceGameId: p.url,
      title: d.base,
      groupKey: d.groupKey,
      edition: d.edition,
      image: p.image,
      platform,
    });
  }
  return hits;
}

export const arcadia: SourceAdapter = {
  id: 'arcadia',
  name: 'Arcadia (Israel)',
  nameHe: 'ארקדיה (Arcadia)',
  platforms: ['ps5', 'ps4', 'xbox', 'switch'],
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
    const viaApi = await searchViaStoreApi(title, platforms);
    if (viaApi) return viaApi;
    const html = await politeFetch(
      `https://arcadia.co.il/?s=${encodeURIComponent(title)}&post_type=product`
    );
    const $ = cheerio.load(html);
    const hits: GameHit[] = [];
    const seen = new Set<string>();

    $('.rt-product-block').each((_i, el) => {
      const $el = $(el);
      const link = $el.find('.rt-title a').first();
      const rawTitle = link.text().trim();
      const url = link.attr('href');
      if (!rawTitle || !url || seen.has(url)) return;
      seen.add(url);

      // The shop search matches descriptions/tags too, so drop products whose
      // name has nothing to do with the query (repair services, other games).
      if (!titleMatchesQuery(title, rawTitle)) return;

      const d = describeProduct(rawTitle);
      if (d.accessory) return;
      const platform = d.platforms[0];
      if (!platform || platform === 'pc') return; // physical stores sell console discs; a "pc" match is a gaming PC
      if (platforms.length && !platforms.includes(platform)) return;

      const price = parseNis($el.find('.woocommerce-Price-amount').last().text());
      if (price == null) return;

      let image = $el.find('.rt-thumb img').attr('src') ?? undefined;
      if (image?.startsWith('//')) image = 'https:' + image;

      offerCache.set(url, makeOffer(rawTitle, price, url));
      hits.push({
        sourceId: 'arcadia',
        sourceGameId: url,
        title: d.base,
        groupKey: d.groupKey,
        edition: d.edition,
        image,
        platform,
      });
    });
    return hits;
  },

  async getOffers(sourceGameId: string): Promise<Offer[]> {
    const cached = offerCache.get(sourceGameId);
    if (cached) return [cached];
    const html = await politeFetch(sourceGameId);
    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim();
    const price = parseNis(
      $('.summary .woocommerce-Price-amount, .price .woocommerce-Price-amount').last().text()
    );
    if (price == null) return [];
    return [makeOffer(title, price, sourceGameId)];
  },
};
