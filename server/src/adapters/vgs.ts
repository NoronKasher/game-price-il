import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { politeFetch } from './politeFetch.ts';
import { describeProduct, looksDigital, parseNis, titleMatchesQuery } from '../normalize.ts';

/**
 * VGS (vgs.co.il) — Israeli gaming chain, Tel Aviv. Standard WooCommerce
 * markup, no bot protection observed. Physical console games priced in ILS.
 * sourceGameId = product page URL.
 */

/** WooCommerce category-class → platform, more reliable than title words. */
const CAT_PLATFORM: [string, Platform][] = [
  ['product_cat-playstation-5', 'ps5'],
  ['product_cat--ps5', 'ps5'],
  ['product_cat-playstation-4', 'ps4'],
  ['product_cat--ps4', 'ps4'],
  ['product_cat-xbox-series', 'xbox'],
  ['product_cat-xbox-one', 'xbox'],
  ['product_cat-nintendo-switch', 'switch'],
];

/** Search results carry the price; remember it so getOffers avoids a refetch. */
const offerCache = new Map<string, Offer>();

function classPlatform(classes: string): Platform | null {
  for (const [cls, platform] of CAT_PLATFORM) {
    if (classes.includes(cls)) return platform;
  }
  return null;
}

function makeOffer(title: string, price: number, url: string): Offer {
  return {
    store: 'VGS',
    kind: looksDigital(title) ? 'digital' : 'physical',
    location: 'israel',
    price,
    currency: 'ILS',
    priceILS: price,
    url,
  };
}

export const vgs: SourceAdapter = {
  id: 'vgs',
  name: 'VGS (Israel)',
  nameHe: 'וי ג׳י אס (VGS)',
  platforms: ['ps5', 'ps4', 'xbox', 'switch'],
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
    const html = await politeFetch(
      `https://vgs.co.il/?s=${encodeURIComponent(title)}&post_type=product`
    );
    const $ = cheerio.load(html);
    const hits: GameHit[] = [];
    const seen = new Set<string>(); // VGS renders the list twice (desktop+mobile)

    $('li.product').each((_i, el) => {
      const $el = $(el);
      const classes = $el.attr('class') ?? '';
      if (classes.includes('outofstock')) return;

      const rawTitle = $el.find('.woocommerce-loop-product__title').first().text().trim();
      const url = $el.find('a.woocommerce-loop-product__link').attr('href');
      if (!rawTitle || !url) return;
      if (seen.has(url)) return;
      seen.add(url);

      // The shop search matches descriptions/tags too, so drop products whose
      // name has nothing to do with the query (repair services, other games).
      if (!titleMatchesQuery(title, rawTitle)) return;

      const d = describeProduct(rawTitle);
      if (d.accessory) return; // racing wheels, cases, Funko — not games
      const platform = classPlatform(classes) ?? d.platforms[0];
      if (!platform || platform === 'pc') return; // console/accessory/gaming-PC listing, not a console game
      if (platforms.length && !platforms.includes(platform)) return;

      // Sale items render <del>old</del><ins>new</ins>; last amount is current.
      const priceText = $el.find('.price .woocommerce-Price-amount').last().text();
      const price = parseNis(priceText);
      if (price == null) return;

      let image = $el.find('img.wp-post-image').attr('src') ?? undefined;
      if (image?.startsWith('//')) image = 'https:' + image;

      offerCache.set(url, makeOffer(rawTitle, price, url));
      hits.push({
        sourceId: 'vgs',
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
    // Cache miss (e.g. wishlist refresh after restart): read the product page.
    const html = await politeFetch(sourceGameId);
    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim();
    const priceText = $('.summary .woocommerce-Price-amount, .price .woocommerce-Price-amount')
      .last()
      .text();
    const price = parseNis(priceText);
    if (price == null) return [];
    return [makeOffer(title, price, sourceGameId)];
  },
};
