import * as cheerio from 'cheerio';
import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { toILS, canConvert } from '../rates.ts';
import { describeProduct } from '../normalize.ts';

/**
 * PlayStation Store — regional price board.
 *
 * PSN has no clean public price API, but its store *server-renders* search
 * results as HTML with stable `data-qa` selectors (the same markup a browser
 * with JavaScript disabled receives). We read those pages politely — exactly
 * what the user's own browser does — and parse the tiles. No GraphQL hashes,
 * no headless browser, no bot-protection circumvention.
 *
 * Cross-region: PSN product ids are region-specific by prefix (EP/UP/HP), but
 * the trailing product code (e.g. "GOWRAGNAROK00000") is stable across
 * regions, so we search each region's store and match a game by that code.
 *
 * sourceGameId = "<productCode>~<url-encoded search name>".
 */

const UA = 'GamePriceIL/0.1 (personal wishlist price tracker for Israel)';
const CACHE_TTL = 10 * 60 * 1000;
const MAX_CONCURRENT = 3;

/** Regions with a stable PSN locale AND a stable display currency. */
interface PsnRegion {
  market: string;
  locale: string;
  currency: string;
  nameHe: string;
  flag: string;
  pinned: boolean;
}
const PSN_REGIONS: PsnRegion[] = [
  { market: 'US', locale: 'en-us', currency: 'USD', nameHe: 'ארה״ב', flag: '🇺🇸', pinned: true },
  { market: 'TR', locale: 'en-tr', currency: 'TRY', nameHe: 'טורקיה', flag: '🇹🇷', pinned: true },
  { market: 'IN', locale: 'en-in', currency: 'INR', nameHe: 'הודו', flag: '🇮🇳', pinned: true },
  { market: 'ZA', locale: 'en-za', currency: 'ZAR', nameHe: 'דרום אפריקה', flag: '🇿🇦', pinned: false },
  { market: 'GB', locale: 'en-gb', currency: 'GBP', nameHe: 'בריטניה', flag: '🇬🇧', pinned: false },
];

const cache = new Map<string, { html: string; at: number }>();

async function fetchPsn(url: string): Promise<string | null> {
  const c = cache.get(url);
  if (c && Date.now() - c.at < CACHE_TTL) return c.html;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      redirect: 'manual', // a 302 means "no store here" — treat as no data
      signal: AbortSignal.timeout(15000),
    });
    if (res.status !== 200) return null;
    const html = await res.text();
    cache.set(url, { html, at: Date.now() });
    return html;
  } catch {
    return null;
  }
}

/** Run tasks with a small concurrency cap (PSN is one host; keep it neighbourly). */
async function pooled<T, R>(items: T[], fn: (t: T) => Promise<R>, limit = MAX_CONCURRENT): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Parse a localized price string to a number.
 *
 * The trailing separator is a decimal point only when it is followed by 1–2
 * digits ("1.399,50"→1399.5, "£59.99"→59.99); a separator followed by 3 digits
 * is a thousands group ("₹2,499"→2499, "R 1,559"→1559). Any non-decimal
 * separators are thousands and are stripped.
 */
export function parseLocalizedPrice(text: string): number | null {
  const digits = text.replace(/[^\d.,]/g, '');
  if (!digits) return null;
  const lastSep = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  let normalized: string;
  if (lastSep === -1) {
    normalized = digits;
  } else {
    const decimals = digits.length - lastSep - 1;
    if (decimals >= 1 && decimals <= 2) {
      // trailing separator is the decimal point; everything else is thousands
      const intPart = digits.slice(0, lastSep).replace(/[.,]/g, '');
      normalized = `${intPart}.${digits.slice(lastSep + 1)}`;
    } else {
      // no decimals — all separators are thousands groupings
      normalized = digits.replace(/[.,]/g, '');
    }
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

interface Tile {
  code: string; // stable cross-region product code
  name: string;
  platforms: string[];
  price?: string;
  strike?: string;
  image?: string;
  href: string;
}

/** Parse the server-rendered search tiles from a store page. */
function parseTiles(html: string, locale: string): Tile[] {
  const $ = cheerio.load(html);
  const tiles: Tile[] = [];
  for (let i = 0; i < 48; i++) {
    const nameEl = $(`[data-qa="search#productTile${i}#product-name"]`);
    if (nameEl.length === 0) continue;
    const link = nameEl.closest(`a[href*="/product/"]`);
    const href = link.attr('href') ?? '';
    const m = href.match(/\/product\/[A-Z0-9]+-[A-Z0-9]+_00-([A-Z0-9]+)/);
    if (!m) continue;
    const price = $(`[data-qa="search#productTile${i}#price#display-price"]`).first().text().trim();
    const strike = $(`[data-qa="search#productTile${i}#price#price-strikethrough"]`).first().text().trim();
    const tags = [0, 1, 2]
      .map((t) => $(`[data-qa="search#productTile${i}#game-art#tag${t}"]`).first().text().trim())
      .filter(Boolean);
    let image = $(`[data-qa="search#productTile${i}#game-art#image#image-no-js"]`).attr('src');
    tiles.push({
      code: m[1]!,
      name: nameEl.text().trim(),
      platforms: tags,
      price: price || undefined,
      strike: strike || undefined,
      image: image || undefined,
      href: href.startsWith('http') ? href : `https://store.playstation.com${href}`,
    });
  }
  return tiles;
}

const PLATFORM_TAG: Record<Platform, string> = {
  ps5: 'PS5',
  ps4: 'PS4',
  pc: '',
  'xbox-series': '',
  'xbox-one': '',
  switch: '',
};

function tileMatchesPlatform(tile: Tile, platform: Platform): boolean {
  const want = PLATFORM_TAG[platform];
  return want ? tile.platforms.some((t) => t.toUpperCase().includes(want)) : true;
}

export const psn: SourceAdapter = {
  id: 'psn-store',
  name: 'PlayStation Store (regional)',
  nameHe: 'חנות פלייסטיישן — לפי אזור',
  platforms: ['ps5', 'ps4'],
  enabled: true,

  async search(title: string, platforms: Platform[]): Promise<GameHit[]> {
    // Search the US store (broadest catalog, stable en-us locale) for discovery.
    const html = await fetchPsn(
      `https://store.playstation.com/en-us/search/${encodeURIComponent(title)}`
    );
    if (!html) return [];
    const tiles = parseTiles(html, 'en-us');

    const hits: GameHit[] = [];
    const seen = new Set<string>();
    for (const tile of tiles) {
      const d = describeProduct(tile.name);
      if (d.accessory) continue;
      for (const platform of ['ps5', 'ps4'] as Platform[]) {
        if (platforms.length && !platforms.includes(platform)) continue;
        if (!tileMatchesPlatform(tile, platform)) continue;
        const key = `${tile.code}:${platform}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({
          sourceId: 'psn-store',
          sourceGameId: `${tile.code}~${encodeURIComponent(d.base || tile.name)}`,
          title: d.base || tile.name,
          groupKey: d.groupKey,
          edition: d.edition,
          image: tile.image,
          platform,
        });
      }
    }
    return hits;
  },

  /** One offer per PSN region, matched by product code, cheapest ₪ first. */
  async getOffers(sourceGameId: string, platform: Platform): Promise<Offer[]> {
    const [code, encodedName] = sourceGameId.split('~');
    const name = decodeURIComponent(encodedName ?? '');
    if (!code || !name) return [];

    const results = await pooled(PSN_REGIONS, async (region) => {
      const html = await fetchPsn(
        `https://store.playstation.com/${region.locale}/search/${encodeURIComponent(name)}`
      );
      if (!html) return null;
      const tiles = parseTiles(html, region.locale);
      const tile = tiles.find(
        (t) => t.code === code && tileMatchesPlatform(t, platform) && t.price
      );
      if (!tile?.price) return null;
      const native = parseLocalizedPrice(tile.price);
      if (native == null || native <= 0) return null;
      if (!(await canConvert(region.currency))) return null;
      const regular = tile.strike ? parseLocalizedPrice(tile.strike) : null;
      const onSale = regular != null && regular > native;
      const offer: Offer = {
        store: `PS Store ${region.flag}`,
        kind: 'digital',
        location: 'international',
        price: native,
        currency: region.currency,
        priceILS: await toILS(native, region.currency),
        retailPrice: onSale ? regular! : undefined,
        savings: onSale ? Math.round(((regular! - native) / regular!) * 100) : undefined,
        region: region.market,
        regionName: region.nameHe,
        flag: region.flag,
        pinned: region.pinned,
        url: tile.href,
      };
      return offer;
    });

    return results.filter((o): o is Offer => o !== null).sort((a, b) => a.priceILS - b.priceILS);
  },
};
