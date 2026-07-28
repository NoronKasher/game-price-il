import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { politeFetch } from './politeFetch.ts';
import { absoluteUrl } from '../net.ts';
import { describeProduct, looksDigital, parseNis, titleMatchesQuery } from '../normalize.ts';

/**
 * Bug (bug.co.il) — large Israeli electronics chain. Server-renders its search
 * grid as `.product-cube` tiles (no bot challenge; Cloudflare only fronts it,
 * content is served to a plain request). Each tile carries the full product
 * name and the console in data attributes, which is cleaner than parsing the
 * abbreviated visible title:
 *   - data-fullName    "Mortal Kombat 1 (2023) Standard Edition Playstation - PS5"
 *   - data-manufacturer "Playstation - PS5" / "Nintendo Switch" / "XBOX SERIES"
 * Being a general electronics store, most of the catalog is non-games; mapping
 * data-manufacturer to a console platform naturally drops accessories and other
 * hardware (Nacon/Razer/HORI/Samsung… → no platform → skipped).
 * sourceGameId = absolute product page URL.
 */

const BASE = 'https://www.bug.co.il';
const offerCache = new Map<string, Offer>();

/** Map Bug's data-manufacturer label to a console platform, or null if not a console. */
function manufacturerPlatform(manufacturer: string): Platform | null {
  const s = manufacturer.toUpperCase();
  if (s.includes('PS5')) return 'ps5';
  if (s.includes('PS4')) return 'ps4';
  if (s.includes('XBOX SERIES')) return 'xbox-series';
  if (s.includes('XBOX ONE')) return 'xbox-one';
  if (s.includes('SWITCH')) return 'switch';
  return null;
}

function makeOffer(title: string, price: number, url: string, oldPrice?: number): Offer {
  return {
    store: 'Bug',
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

export const bug: SourceAdapter = {
  id: 'bug',
  name: 'Bug (Israel)',
  nameHe: 'באג (Bug)',
  platforms: ['ps5', 'ps4', 'xbox-series', 'xbox-one', 'switch'],
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
    const html = await politeFetch(`${BASE}/search?q=${encodeURIComponent(title)}`);
    const $ = cheerio.load(html);
    const hits: GameHit[] = [];
    const seen = new Set<string>();

    $('.product-cube').each((_i, el) => {
      const $el = $(el);
      const manufacturer = $el.attr('data-manufacturer') ?? '';
      const link = $el.find('a.tpurl').first();
      const href = link.attr('href');
      const fullName = $el.attr('data-fullname') ?? link.attr('title') ?? link.text().trim();
      if (!href || !fullName) return;
      const url = absoluteUrl(BASE, href);
      if (seen.has(url)) return;
      seen.add(url);

      // data-fullName ends with the manufacturer label ("… Playstation - PS5");
      // drop it so the title groups cleanly with the same game from other stores.
      let rawTitle = fullName;
      if (manufacturer && rawTitle.endsWith(manufacturer)) {
        rawTitle = rawTitle.slice(0, -manufacturer.length);
      }
      rawTitle = rawTitle.replace(/[\s\-–|]+$/, '').trim();

      // The shop search matches descriptions/tags too, so drop products whose
      // name has nothing to do with the query (repair services, other games).
      if (!titleMatchesQuery(title, rawTitle)) return;

      const d = describeProduct(rawTitle);
      if (d.accessory) return; // controllers, headsets, Funko — not games
      // Manufacturer label is the reliable platform signal; fall back to the title.
      const platform = manufacturerPlatform(manufacturer) ?? d.platforms[0];
      if (!platform || platform === 'pc') return; // non-console (or a gaming PC), not a console game
      if (platforms.length && !platforms.includes(platform)) return;

      // Price: <div class="price"><del>old</del><span>current</span></div>
      const $price = $el.find('.price').first();
      const price = parseNis($price.find('span').last().text());
      if (price == null) return;
      const oldPrice = parseNis($price.find('del').first().text()) ?? undefined;

      const image = $el.find('.product-preview-image img').attr('data-original') ?? undefined;

      offerCache.set(url, makeOffer(rawTitle, price, url, oldPrice));
      hits.push({
        sourceId: 'bug',
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
    // Product pages carry a JSON-LD Product with the current price.
    const price =
      parseNis(html.match(/"@type":"Product"[\s\S]*?"price":\s*"?([\d.]+)"?/)?.[1] ?? '') ??
      parseNis($('.price span').last().text());
    if (price == null) return [];
    return [makeOffer(title, price, sourceGameId)];
  },
};
