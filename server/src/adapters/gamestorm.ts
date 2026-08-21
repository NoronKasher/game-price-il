import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { politeFetch } from './politeFetch.ts';
import { absoluteUrl } from '../net.ts';
import { describeProduct, looksDigital, parseNis, titleMatchesQuery } from '../normalize.ts';

/**
 * Game Storm (gamestorm.co.il) — Israeli gaming/computer store, custom engine.
 *
 * Its visible search is a POST to /search carrying a per-page CSRF token, and a
 * plain GET of that path quietly returns a "לא נמצא" page full of unrelated menu
 * products — which is how this adapter came to return nothing at all while
 * looking perfectly healthy. (The health canary is what caught it.) The store's
 * own type-ahead calls a simple GET instead, so that is what we read; it answers
 * with names and product links, and the price comes from the product page in
 * getOffers, exactly as before.
 *
 * The platform is in the product name; search returns accessories too, and those
 * lack a platform token and are skipped. sourceGameId = absolute product URL.
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
    // The type-ahead endpoint the store's own search box calls.
    const html = await politeFetch(
      `${BASE}/scripts/search_results_load.php?p=products&q=${encodeURIComponent(title)}`
    );
    const $ = cheerio.load(html);
    const hits: GameHit[] = [];
    const seen = new Set<string>();

    $('.livesearch_option').each((_i, el) => {
      const $el = $(el);
      const href = $el.find('a').first().attr('href');
      const rawTitle = $el.find('.livesearch_text').first().text().trim();
      if (!href || !rawTitle) return;
      const url = absoluteUrl(BASE, href);
      if (!url || seen.has(url)) return;

      // The store search matches descriptions too, so drop products whose name
      // has nothing to do with the query.
      if (!titleMatchesQuery(title, rawTitle)) return;

      const d = describeProduct(rawTitle);
      if (d.accessory) return;
      const platform = d.platforms[0];
      // Physical shops sell console discs; a "pc" match here is a gaming PC.
      if (!platform || platform === 'pc') return;
      if (platforms.length && !platforms.includes(platform)) return;
      seen.add(url);

      let image = $el.find('img').first().attr('src') ?? undefined;
      if (image) image = absoluteUrl(BASE, image) ?? undefined;

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
    // THIS product's price only. A product page also renders ~58 related-item
    // tiles that carry `.product_preview_price_current`, so a generic selector
    // list picked whichever menu item happened to come first and every game in
    // the store came back at the same price.
    const price = parseNis($('#price_total_value, #product_prices [itemprop="price"]').first().text());
    if (price == null) return [];
    const original = parseNis($('#product_prices .price_original_value').first().text());
    return [makeOffer(title, price, sourceGameId, original ?? undefined)];
  },
};
