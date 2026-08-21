import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { politeFetch } from './politeFetch.ts';
import { describeProduct, looksDigital, parseNis, titleMatchesQuery } from '../normalize.ts';
import { wooSearch } from './wooStore.ts';

/**
 * VGS (vgs.co.il) — Israeli gaming chain, Tel Aviv. Standard WooCommerce,
 * physical console games priced in ILS. sourceGameId = product page URL.
 *
 * Tries the shop's public Store API first and parses the rendered markup
 * otherwise. NOTE: unlike Arcadia's, the API path here is unverified — vgs.co.il
 * answered 503 throughout the work that added it — which is exactly why it
 * returns to the HTML path whenever the API gives nothing usable, including
 * when it cannot place a product on a console.
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

/**
 * Platform from the Store API's category slugs. VGS files games by console far
 * more reliably than it names the console in the title, so this mirrors the
 * class-based lookup above rather than falling back to title parsing.
 */
function slugPlatform(slugs: string[]): Platform | null {
  const joined = slugs.join(' ');
  if (/playstation-5|(^|\s)ps5/.test(joined)) return 'ps5';
  if (/playstation-4|(^|\s)ps4/.test(joined)) return 'ps4';
  if (/xbox/.test(joined)) return 'xbox';
  if (/switch|nintendo/.test(joined)) return 'switch';
  return null;
}

/**
 * The Store API path. Returns null when the API is unavailable OR when it
 * yields nothing we can place on a console — either way the caller falls back
 * to the markup, which is the only path proven against this shop.
 */
async function searchViaStoreApi(title: string, platforms: Platform[]): Promise<GameHit[] | null> {
  const products = await wooSearch('https://vgs.co.il', title);
  if (!products) return null;
  const hits: GameHit[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    if (seen.has(p.url)) continue;
    if (!titleMatchesQuery(title, p.name)) continue;
    const d = describeProduct(p.name);
    if (d.accessory) continue;
    const platform = slugPlatform(p.categories) ?? d.platforms[0] ?? null;
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
      sourceId: 'vgs',
      sourceGameId: p.url,
      title: d.base,
      groupKey: d.groupKey,
      edition: d.edition,
      image: p.image,
      platform,
    });
  }
  return hits.length > 0 ? hits : null;
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
    const viaApi = await searchViaStoreApi(title, platforms);
    if (viaApi) return viaApi;
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
