import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { politeFetch } from './politeFetch.ts';
import { absoluteUrl } from '../net.ts';
import {
  describeProduct,
  looksDigital,
  looksLikeAccessory,
  parseNis,
  titleMatchesQuery,
} from '../normalize.ts';

/**
 * Ivory (ivory.co.il) — large Israeli electronics retailer. The search grid is
 * server-rendered as `.catalogVertical_item.category-list` tiles (Cloudflare only
 * fronts the site; full content is served to a plain request, no challenge). Games
 * are a minor slice of a general catalog, so coverage is thin but real, and game
 * listings carry a console token in the title ("משחק פלייסטיישן 5 … PS5").
 * sourceGameId = absolute product page URL (catalog.php?id=…).
 */

const BASE = 'https://www.ivory.co.il';
const offerCache = new Map<string, Offer>();

/**
 * Ivory game titles are bilingual: "משחק ל<platform> – <שם עברי> <English Name>
 * <Edition> <Platform>". The clean English game name (with its edition and the
 * English console token) is the trailing Latin-script run — using it as the raw
 * title lets describeProduct extract the platform/edition and lets the groupKey
 * merge with the same game from the English-titled stores. Falls back to the full
 * title for the rare Hebrew-only listing.
 */
function englishName(title: string): string {
  // The title interleaves Hebrew and the English name (which may sit in the
  // MIDDLE, e.g. "…רגילה EA Sports FC 25 …מוחדש"). Grabbing from the first Latin
  // char wrongly kept the Hebrew middle; instead take the LONGEST run of
  // non-Hebrew text (the English name), then trim stray separators.
  const segments = title
    .split(/[֐-׿]+/)
    .map((s) => s.replace(/^[\s\-–|:]+|[\s\-–|:]+$/g, '').trim())
    .filter(Boolean);
  if (segments.length === 0) return title.trim();
  return segments.reduce((a, b) => (b.length > a.length ? b : a));
}

function makeOffer(title: string, price: number, url: string, oldPrice?: number, eilat?: number): Offer {
  return {
    store: 'Ivory',
    kind: looksDigital(title) ? 'digital' : 'physical',
    location: 'israel',
    price,
    currency: 'ILS',
    priceILS: price,
    retailPrice: oldPrice && oldPrice > price ? oldPrice : undefined,
    savings: oldPrice && oldPrice > price ? Math.round(((oldPrice - price) / oldPrice) * 100) : undefined,
    // Ivory has an Eilat branch and prints its VAT-free price next to the
    // national one ("מחיר באילת: 194 ₪"). It is read, never calculated.
    eilatPriceILS: eilat != null && eilat > 0 && eilat < price ? eilat : undefined,
    url,
  };
}

export const ivory: SourceAdapter = {
  id: 'ivory',
  name: 'Ivory (Israel)',
  nameHe: 'אייבורי (Ivory)',
  platforms: ['ps5', 'ps4', 'xbox', 'switch'],
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
    const html = await politeFetch(`${BASE}/catalog.php?act=cat&q=${encodeURIComponent(title)}`);
    const $ = cheerio.load(html);
    const hits: GameHit[] = [];
    const seen = new Set<string>();

    // `.category-list` are the actual search results; `.homepage-list` tiles on the
    // same page are unrelated promo boxes (branches, PC builder, brands) — skip those.
    $('.catalogVertical_item.category-list').each((_i, el) => {
      const $el = $(el);
      const link = $el.find('a.product-anchor').first();
      const href = link.attr('href');
      const fullTitle = $el.find('.title_product_catalog').first().text().trim();
      if (!href || !fullTitle) return;
      const url = absoluteUrl(BASE, href);
      if (seen.has(url)) return;
      seen.add(url);

      // The shop search matches descriptions/tags too, so drop products whose
      // name has nothing to do with the query (accessories, other games). Match
      // against the full bilingual title so Hebrew queries can hit too.
      if (!titleMatchesQuery(title, fullTitle)) return;

      const rawTitle = englishName(fullTitle);
      const d = describeProduct(rawTitle);
      // Test the FULL bilingual title as well: describeProduct only sees the
      // English run, so the Hebrew accessory vocabulary (אוזניות, בקר, הגה…) is
      // already stripped by englishName and could never match there — a
      // Hebrew-labelled headset whose English part is just a brand and a console
      // token ("SteelSeries Arctis PS5") would sail through as a game.
      if (d.accessory || looksLikeAccessory(fullTitle)) return;
      const platform = d.platforms[0];
      if (!platform || platform === 'pc') return; // accessory/gaming-PC or unrecognized platform
      if (platforms.length && !platforms.includes(platform)) return;

      // The first pricing row holds the regular price and, on sale, a second
      // (lower) current price — so the last amount is the one to charge.
      const priceEls = $el.find('.pricing-row').first().find('.price-area').not('.eilatprice').find('.price');
      const price = parseNis(priceEls.last().text());
      if (price == null) return;
      const oldPrice = priceEls.length > 1 ? (parseNis(priceEls.first().text()) ?? undefined) : undefined;
      // The Eilat branch's own price, in a later row, on products that have one.
      const eilat = parseNis($el.find('.price.eilatprice').first().text()) ?? undefined;

      let image = $el.find('img.img-fluid[data-src]').first().attr('data-src') ?? undefined;
      if (image && !/^https?:\/\//.test(image)) image = BASE + '/' + image.replace(/^\//, '');

      offerCache.set(url, makeOffer(rawTitle, price, url, oldPrice, eilat));
      hits.push({
        sourceId: 'ivory',
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
    const title = englishName($('h1').first().text().trim());
    // Product pages carry a JSON-LD Product with the current price.
    const price =
      parseNis(html.match(/"@type":"Product"[\s\S]*?"price":\s*"?([\d.]+)"?/)?.[1] ?? '') ??
      parseNis($('.pricing-row').first().find('.price-area').not('.eilatprice').find('.price').last().text());
    if (price == null) return [];
    return [makeOffer(title, price, sourceGameId)];
  },
};
