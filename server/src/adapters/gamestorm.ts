import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { politeFetch } from './politeFetch.ts';
import { absoluteUrl } from '../net.ts';
import { describeProduct, looksDigital, parseNis, titleMatchesQuery } from '../normalize.ts';

/**
 * Game Storm (gamestorm.co.il) — Israeli gaming/computer store. Custom store
 * engine with server-rendered `.product_preview` tiles (name, current/original
 * price, image). No bot protection observed. The platform is in the product
 * name. Search returns non-games too (e.g. accessories) — those lack a platform
 * token and are skipped. sourceGameId = absolute product URL.
 */

const BASE = 'https://www.gamestorm.co.il';
const offerCache = new Map<string, Offer>();

function makeOffer(title: string, price: number, url: string, oldPrice?: number): Offer {
  return {
    store: 'Game Storm',
    kind: looksDigital(title) ? 'digital' : 'physical',
    location: 'israel',
    price,
    currency: 'ILS',
    priceILS: price,
    retailPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
    savings: oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : undefined,
    url,
  };
}

export const gamestorm: SourceAdapter = {
  id: 'gamestorm',
  name: 'Game Storm (Israel)',
  nameHe: 'גיים סטורם (Game Storm)',
  platforms: ['ps5', 'ps4', 'xbox', 'switch'],
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
    const html = await politeFetch(`${BASE}/search?q=${encodeURIComponent(title)}`);
    const $ = cheerio.load(html);
    const hits: GameHit[] = [];
    const seen = new Set<string>();

    $('.product_preview').each((_i, el) => {
      const $el = $(el);
      const link = $el.find('.product_preview_name a').first();
      const rawTitle = link.find('[itemprop="name"]').text().trim() || link.text().trim();
      const href = link.attr('href');
      if (!rawTitle || !href) return;
      const url = absoluteUrl(BASE, href);
      if (seen.has(url)) return;
      seen.add(url);

      // The shop search matches descriptions/tags too, so drop products whose
      // name has nothing to do with the query (repair services, other games).
      if (!titleMatchesQuery(title, rawTitle)) return;

      const d = describeProduct(rawTitle);
      if (d.accessory) return;
      const platform = d.platforms[0];
      if (!platform || platform === 'pc') return; // physical stores sell console discs; a "pc" match is a gaming PC, not a game
      if (platforms.length && !platforms.includes(platform)) return;

      const price = parseNis($el.find('.product_preview_price_current').first().text());
      if (price == null) return;
      const oldPrice = parseNis($el.find('.product_preview_price_original').first().text()) ?? undefined;

      let image =
        $el.find('.product_preview_image img').attr('data-src') ??
        $el.find('.product_preview_image img').attr('src') ??
        undefined;
      if (image?.startsWith('//')) image = 'https:' + image;

      offerCache.set(url, makeOffer(rawTitle, price, url, oldPrice));
      hits.push({
        sourceId: 'gamestorm',
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
    const price = parseNis($('.product_preview_price_current, .price_current, [itemprop="price"]').first().text());
    if (price == null) return [];
    return [makeOffer(title, price, sourceGameId)];
  },
};
