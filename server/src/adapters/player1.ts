import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { politeFetch } from './politeFetch.ts';
import { absoluteUrl } from '../net.ts';
import { describeProduct, looksDigital, parseNis, titleMatchesQuery } from '../normalize.ts';

/**
 * Player1 (player1.co.il) — Israeli gaming store, Tel Aviv. nopCommerce
 * markup, no bot protection observed. Physical console games priced in ILS.
 * sourceGameId = product page URL (absolute).
 */

const BASE = 'https://player1.co.il';

const offerCache = new Map<string, Offer>();

function makeOffer(title: string, price: number, url: string, oldPrice?: number): Offer {
  return {
    store: 'Player1',
    kind: looksDigital(title) ? 'digital' : 'physical',
    location: 'israel',
    price,
    currency: 'ILS',
    priceILS: price,
    retailPrice: oldPrice,
    savings:
      oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : undefined,
    url,
  };
}

export const player1: SourceAdapter = {
  id: 'player1',
  name: 'Player1 (Israel)',
  nameHe: 'פלייר1 (Player1)',
  platforms: ['ps5', 'ps4', 'xbox', 'switch'],
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
    const html = await politeFetch(`${BASE}/search?q=${encodeURIComponent(title)}`);
    const $ = cheerio.load(html);
    const hits: GameHit[] = [];

    $('div.product-item').each((_i, el) => {
      const $el = $(el);
      const link = $el.find('.product-title a').first();
      const rawTitle = link.text().trim();
      const href = link.attr('href');
      if (!rawTitle || !href) return;
      const url = absoluteUrl(BASE, href);

      // The shop search matches descriptions/tags too, so drop products whose
      // name has nothing to do with the query (repair services, other games).
      if (!titleMatchesQuery(title, rawTitle)) return;

      const d = describeProduct(rawTitle);
      if (d.accessory) return; // racing wheels, cases, Funko — not games
      const platform = d.platforms[0];
      if (!platform || platform === 'pc') return; // accessory/gaming-PC or unrecognized platform
      if (platforms.length && !platforms.includes(platform)) return;

      const price = parseNis($el.find('.price.actual-price').first().text());
      if (price == null) return;
      const oldPrice = parseNis($el.find('.price.old-price').first().text()) ?? undefined;

      const image =
        $el.find('img.picture-img').attr('data-lazyloadsrc') ??
        $el.find('img.picture-img').attr('src') ??
        undefined;

      offerCache.set(url, makeOffer(rawTitle, price, url, oldPrice));
      hits.push({
        sourceId: 'player1',
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
    const priceAttr = $('[itemprop="price"]').attr('content');
    const price = priceAttr ? Number(priceAttr) : parseNis($('[id^="price-value-"]').text());
    if (price == null || Number.isNaN(price)) return [];
    return [makeOffer(title, price, sourceGameId)];
  },
};
