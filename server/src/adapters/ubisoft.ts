import type { GameHit, Offer, SourceAdapter } from './types.ts';
import { toILS, canConvert } from '../rates.ts';
import { describeProduct, parseLocalizedPrice } from '../normalize.ts';
import { REGIONS } from '../regions.ts';

/**
 * Ubisoft Store (Ubisoft Connect) — regional price board for PC games.
 *
 * Ubisoft runs a genuinely per-country storefront at store.ubisoft.com/<path>/,
 * each its own Salesforce Commerce site ("Sites-tr_ubisoft-Site") pricing in its
 * own currency, and it answers a plain server-side request — no bot wall, so no
 * bot wall to work around. Prices are only ever rendered as formatted text in
 * the product tiles, so we read the search grid and parse it.
 *
 * Product ids are NOT stable across countries (Far Cry 6 is a different pid on
 * /us/ and /tr/), so, like the PlayStation adapter, each region is searched by
 * title and matched on the normalized group key.
 *
 * Known limit: stores that list a game only under a translated name (Japan sells
 * "ファークライ5", never "Far Cry 5") can't be matched from an English title, so
 * they simply contribute no row. Korea lists most games in English and does. A
 * missing row is the intended outcome there — better than pricing the wrong game.
 *
 * sourceGameId = url-encoded base title.
 */

const BASE = 'https://store.ubisoft.com';
const UA = 'GamePriceIL/0.1 (personal wishlist price tracker for Israel)';
const CACHE_TTL = 30 * 60 * 1000;
const MAX_CONCURRENT = 4;

/**
 * The country paths that are REAL, separate stores, mapped to our region codes.
 *
 * This list is deliberately short and was verified by probing every path: only
 * these return their own `Sites-<cc>_ubisoft-Site` with their own currency.
 * Every other country path (br, mx, au, pl, se, in, za, sa, hk, sg, tw…) quietly
 * serves the SHARED Ireland store in EUR while keeping the country in the URL.
 * Listing those would print an Irish euro price under a Brazilian flag — a
 * confident, wrong number, which is worse than no row at all. So they're out.
 *
 * `currency` is the fallback only; the live currency is read off the page.
 */
const UBI_MARKETS: Record<string, { path: string; currency: string }> = {
  US: { path: 'us', currency: 'USD' },
  GB: { path: 'uk', currency: 'GBP' },
  CA: { path: 'ca', currency: 'CAD' },
  DE: { path: 'de', currency: 'EUR' },
  FR: { path: 'fr', currency: 'EUR' },
  TR: { path: 'tr', currency: 'TRY' },
  JP: { path: 'jp', currency: 'JPY' },
  KR: { path: 'kr', currency: 'KRW' },
};

/** Our regions that Ubisoft actually prices separately, in board order. */
const UBI_REGIONS = REGIONS.filter((r) => UBI_MARKETS[r.market]).map((r) => ({
  ...r,
  ...UBI_MARKETS[r.market]!,
}));

const cache = new Map<string, { body: string; at: number }>();

async function fetchHtml(url: string): Promise<string | null> {
  const c = cache.get(url);
  if (c && Date.now() - c.at < CACHE_TTL) return c.body;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (res.status !== 200) return null;
    const body = await res.text();
    cache.set(url, { body, at: Date.now() });
    return body;
  } catch {
    return null;
  }
}

/**
 * Decode the HTML entities in Ubisoft's markup.
 *
 * Numeric entities matter more than they look: "&#36;59.99" left encoded parses
 * as 3659.99, because the price parser keeps every digit it sees. Named ones
 * matter for titles — an undecoded "Assassin&rsquo;s Creed" normalizes to the
 * group key "assassin rsquo s creed" and stops matching itself across stores.
 * Anything not listed becomes a space: unknown entities are accented letters in
 * localized subtitles, where a gap is harmless and a stray word is not.
 */
const ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", nbsp: ' ', reg: '®', trade: '™',
  ndash: '–', mdash: '—', yen: '¥', euro: '€', pound: '£', cent: '¢',
  lt: '<', gt: '>', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…',
};
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (_, n) => ENTITIES[n.toLowerCase()] ?? ' ');
}

/** Strip tags and collapse whitespace from a markup fragment. */
function text(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function firstGroup(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? text(m[1]!) : null;
}

interface Tile {
  /** The product name alone, exactly as the tile prints it. */
  title: string;
  /** The tile's edition line ("Gold Edition"), localized — a hint only. */
  subtitle: string | null;
  /** Sale/current price as printed, e.g. "TL374.75". */
  sales: string;
  /** Pre-discount price as printed, when the tile shows one. */
  standard: string | null;
}

/**
 * Ubisoft identifies a SKU in the tile's SUBTITLE, not its title: the game, its
 * season pass, its expansions and its currency packs are all titled "Far Cry 6"
 * and differ only by subtitle ("Standard Edition", "Season Pass", "2400
 * Credits", "Lost Between Worlds"). So the subtitle is the only thing that can
 * tell a game from a $1.20 DLC, and the test has to be POSITIVE — name an
 * edition — because DLC is not reliably keyworded: "Insanity" and "Lost Between
 * Worlds" are add-ons whose names say nothing at all.
 *
 * NON_GAME is still checked first, to reject the near-misses that do contain an
 * edition word ("Game of the Year Upgrade Pass" is a discount, not the game).
 */
const NON_GAME = /\b(credits?|coins?|points?|pack|paket|pass|upgrade|expansion|episode|dlc|bundle|season|currency)\b/i;
const GAME_EDITION =
  /\b(standard|deluxe|gold|ultimate|premium|complete|definitive|collector'?s|legendary|special|anniversary|game of the year|goty)\b/i;
/** The plain edition — what "what does this game cost here" should quote. */
const BASE_EDITION = /\bstandard\b/i;

/**
 * Split a Ubisoft search grid into product tiles.
 *
 * Every tile opens with `card-details__title-wrapper` (verified 1:1 with the
 * per-tile title and price markers), so splitting on it yields one chunk per
 * product; the leading chunk is page chrome and is dropped.
 */
export function parseTiles(html: string): Tile[] {
  const chunks = html.split('card-details__title-wrapper').slice(1);
  const tiles: Tile[] = [];
  for (const chunk of chunks) {
    const title = firstGroup(chunk, /class="prod-title"[^>]*>([\s\S]*?)<\/div>/);
    const sales = firstGroup(chunk, /class="price-sales[^"]*"[^>]*>([\s\S]*?)<\/span>/);
    if (!title || !sales) continue;
    const standard = firstGroup(chunk, /class="price-item"[^>]*>([\s\S]*?)<\/span>/);
    // Kept beside the title, never folded into it: the subtitle is localized, and
    // merging "Far Cry 5" with a Korean "스탠다드 에디션" would change the group key
    // and silently drop every non-English store from the board.
    const subtitle = firstGroup(chunk, /class="card-subtitle"[^>]*>([\s\S]*?)<\/div>/);
    tiles.push({ title, subtitle, sales, standard });
  }
  return tiles;
}

/**
 * Choose the tile that is THE GAME, out of every tile sharing its title.
 *
 * Exported for tests: this is the one decision in the adapter that can quietly
 * print a real-looking but wrong price — pick a DLC tile and the board shows a
 * ₪1.86 "Far Cry 5" that no one can buy.
 */
export function pickGameTile(tiles: Tile[], targetGroup: string): { tile: Tile; value: number } | null {
  const cands = tiles
    .map((tile) => ({ tile, value: parseLocalizedPrice(tile.sales) }))
    .filter(
      (c): c is { tile: Tile; value: number } =>
        describeProduct(c.tile.title).groupKey === targetGroup && c.value != null && c.value > 0
    )
    .filter((c) => {
      const sub = c.tile.subtitle ?? '';
      if (!sub) return true; // a single-SKU game has no edition line
      return !NON_GAME.test(sub) && GAME_EDITION.test(sub);
    });
  if (cands.length === 0) return null;
  // The standard edition is the answer; failing that the cheapest real edition
  // on offer. Never a DLC — those were dropped above.
  const standard = cands.filter((c) => BASE_EDITION.test(c.tile.subtitle ?? '') || !c.tile.subtitle);
  const pool = standard.length > 0 ? standard : cands;
  return pool.reduce((a, b) => (b.value < a.value ? b : a));
}

/** The store's own charged currency, read off the page (falls back to the map). */
function currencyOf(html: string, fallback: string): string {
  const m = html.match(/"currencyCode"\s*:\s*"([A-Z]{3})"/) ?? html.match(/"currency"\s*:\s*"([A-Z]{3})"/);
  return m ? m[1]! : fallback;
}

function searchUrl(path: string, term: string): string {
  return `${BASE}/${path}/search?q=${encodeURIComponent(term)}`;
}

export const ubisoft: SourceAdapter = {
  id: 'ubisoft-store',
  name: 'Ubisoft Store (regional)',
  nameHe: 'יוביסופט קונקט — לפי אזור',
  platforms: ['pc'],
  enabled: true,

  async search(title: string): Promise<GameHit[]> {
    // Discover in the US store (broadest English catalog); regions are matched later.
    const html = await fetchHtml(searchUrl('us', title));
    if (!html) return [];
    const hits: GameHit[] = [];
    const seen = new Set<string>();
    for (const tile of parseTiles(html)) {
      const d = describeProduct(tile.title);
      if (d.accessory) continue;
      if (!d.base) continue;
      // One hit per game, not per edition — the region board prices the base game.
      if (seen.has(d.groupKey)) continue;
      seen.add(d.groupKey);
      hits.push({
        sourceId: 'ubisoft-store',
        sourceGameId: encodeURIComponent(d.base),
        title: d.base,
        groupKey: d.groupKey,
        edition: d.edition,
        platform: 'pc',
      });
      if (hits.length >= 12) break;
    }
    return hits;
  },

  /** One offer per real Ubisoft market, each re-searched in its own store. */
  async getOffers(sourceGameId: string): Promise<Offer[]> {
    const name = decodeURIComponent(sourceGameId);
    if (!name) return [];
    const targetGroup = describeProduct(name).groupKey;

    const results: (Offer | null)[] = [];
    let i = 0;
    async function worker() {
      while (i < UBI_REGIONS.length) {
        results.push(await offerFor(UBI_REGIONS[i++]!));
      }
    }
    async function offerFor(region: (typeof UBI_REGIONS)[number]): Promise<Offer | null> {
      const html = await fetchHtml(searchUrl(region.path, name));
      if (!html) return null;
      const pick = pickGameTile(parseTiles(html), targetGroup);
      if (!pick) return null; // only add-ons here, or a language we can't read

      const value = pick.value;
      const currency = currencyOf(html, region.currency);
      if (!(await canConvert(currency))) return null;
      const base = pick.tile.standard != null ? parseLocalizedPrice(pick.tile.standard) : null;
      const onSale = base != null && base > value;
      return {
        store: `Ubisoft ${region.flag}`,
        kind: 'digital',
        location: region.market === 'IL' ? 'israel' : 'international',
        price: value,
        currency,
        priceILS: await toILS(value, currency),
        retailPrice: onSale ? base : undefined,
        savings: onSale ? Math.round(((base - value) / base) * 100) : undefined,
        region: region.market,
        regionName: region.nameHe,
        flag: region.flag,
        pinned: region.pinned,
        url: searchUrl(region.path, name),
      };
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, UBI_REGIONS.length) }, worker));

    return results.filter((o): o is Offer => o !== null).sort((a, b) => a.priceILS - b.priceILS);
  },
};
