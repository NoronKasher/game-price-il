import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { politeFetch } from './politeFetch.ts';
import { describeProduct, looksDigital, parseNis, titleMatchesQuery } from '../normalize.ts';

/**
 * Arcadia (arcadia.co.il) — Israeli gaming chain. WooCommerce with a custom
 * "rt-" theme; product tiles are server-rendered, no bot protection observed.
 * The platform is embedded in the product title ("PS4 Elden Ring…").
 * sourceGameId = product page URL.
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

export const arcadia: SourceAdapter = {
  id: 'arcadia',
  name: 'Arcadia (Israel)',
  nameHe: 'ארקדיה (Arcadia)',
  platforms: ['ps5', 'ps4', 'xbox-series', 'xbox-one', 'switch'],
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
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
