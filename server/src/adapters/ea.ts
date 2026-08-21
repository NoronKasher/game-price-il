import type { GameHit, Offer, SourceAdapter } from './types.ts';
import { toILS, canConvert } from '../rates.ts';
import { describeProduct, parseLocalizedPrice, titleMatchesQuery } from '../normalize.ts';

/**
 * EA App (ea.com) — the price EA charges a buyer HERE. Single region, by design.
 *
 * EA prices by geo-IP, not by URL: /en-gb/ and /de-de/ both redirect back to the
 * same USD page, ?setCountry=, a country cookie and Accept-Language are all
 * ignored, and the page's own `currenciesDetails` array is empty. So there is no
 * honest way to read another country's EA price from here — that would take a
 * proxy in each country, i.e. defeating EA's geo controls, which this project
 * does not do. What IS honest and useful is the one price EA will actually
 * charge this user, so that's the single row this adapter contributes.
 * (Regional EA prices are a job for the planned browser extension, which can
 * read them from the user's own session.)
 *
 * Discovery: ea.com has no search API (/api/search is a 404), but robots.txt
 * advertises a sitemap, and sitemap-en-us.xml lists every purchasable game's
 * /buy page (~97 of them). We read that once a day and match titles locally —
 * no per-search requests to EA at all.
 *
 * sourceGameId = the buy page's path ("games/mass-effect/mass-effect-andromeda"),
 * deliberately NOT a full URL so it can't be mistaken for a scrape target by the
 * import sanitiser.
 */

const ORIGIN = 'https://www.ea.com';
const SITEMAP = ORIGIN + '/sitemap-en-us.xml';
const UA = 'GamePriceIL/0.1 (personal wishlist price tracker for Israel)';
const SITEMAP_TTL = 24 * 60 * 60 * 1000; // the catalog changes a few times a year
const PAGE_TTL = 30 * 60 * 1000;
const MAX_HITS = 6;

interface EaGame {
  /** Path without a leading slash, e.g. "games/unravel/unravel-two". */
  path: string;
  /** Display title derived from the slug — the real one comes off the page. */
  title: string;
}

let catalog: { games: EaGame[]; at: number } | null = null;
const pageCache = new Map<string, { body: string; at: number }>();

async function fetchText(url: string, timeoutMs = 30000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status === 200 ? await res.text() : null;
  } catch {
    return null;
  }
}

/** "mass-effect-andromeda" -> "Mass Effect Andromeda" */
function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => (/^[ivx]+$/i.test(w) && w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Every purchasable EA game, from the sitemap robots.txt points at. */
async function getCatalog(): Promise<EaGame[]> {
  if (catalog && Date.now() - catalog.at < SITEMAP_TTL) return catalog.games;
  const xml = await fetchText(SITEMAP);
  // Keep serving the last good catalog if EA is briefly unreachable.
  if (!xml) return catalog?.games ?? [];
  const games: EaGame[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const hit = m[1]!.match(/^https:\/\/www\.ea\.com\/(games\/.+?)\/buy\/?$/);
    if (!hit) continue;
    const path = hit[1]!;
    if (seen.has(path)) continue;
    seen.add(path);
    games.push({ path, title: titleFromSlug(path.split('/').pop()!) });
  }
  catalog = { games, at: Date.now() };
  return games;
}

interface EaPrice {
  displayTotal?: string;
  displayTotalWithDiscount?: string;
  discountPercentage?: number;
  currency?: string;
}

/** Read the game's title, art and cheapest edition price off its buy page. */
async function readBuyPage(
  path: string
): Promise<{ title: string; image?: string; price: EaPrice; onEaApp: boolean } | null> {
  const url = ORIGIN + '/' + path + '/buy';
  const cached = pageCache.get(url);
  let html: string | null;
  if (cached && Date.now() - cached.at < PAGE_TTL) {
    html = cached.body;
  } else {
    html = await fetchText(url);
    if (html) pageCache.set(url, { body: html, at: Date.now() });
  }
  if (!html) return null;
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[1]!);
  } catch {
    return null;
  }
  const gd = (data as { props?: { pageProps?: { gameDetails?: Record<string, unknown> } } }).props?.pageProps
    ?.gameDetails;
  if (!gd) return null;

  // Cheapest edition EA lists; `lowestPriceGameEdition` is EA's own pick.
  const lowest = (gd.lowestPriceGameEdition as { price?: EaPrice } | undefined)?.price;
  const editions = (gd.editions as { price?: EaPrice }[] | undefined) ?? [];
  const price = lowest ?? editions[0]?.price;
  if (!price) return null;

  // The storefront name lives in `name`; the sibling `platform` field is null on
  // every entry, so reading that one silently classified every game as
  // console-only and suppressed the whole adapter.
  const platforms = ((gd.platformDetails as { name?: string; platform?: string }[] | undefined) ?? []).map((p) =>
    String(p.name ?? p.platform ?? '').toUpperCase()
  );
  const art = gd.packArt as { url?: string } | string | undefined;
  return {
    title: String(gd.gameTitle ?? '') || titleFromSlug(path.split('/').pop()!),
    image: typeof art === 'string' ? art : art?.url,
    price,
    // A game EA lists only for consoles isn't an EA App purchase.
    onEaApp: platforms.length === 0 || platforms.some((p) => p.includes('EA-APP') || p.includes('PC')),
  };
}

export const ea: SourceAdapter = {
  id: 'ea-app',
  name: 'EA App',
  nameHe: 'EA App',
  platforms: ['pc'],
  enabled: true,

  async search(title: string): Promise<GameHit[]> {
    const games = await getCatalog();
    const hits: GameHit[] = [];
    const seen = new Set<string>();
    for (const g of games) {
      // Same relevance guard every scraped store here uses — the catalog is
      // matched locally, so without it a short query would return all 97 games.
      if (!titleMatchesQuery(title, g.title)) continue;
      const d = describeProduct(g.title);
      if (d.accessory || !d.base) continue;
      if (seen.has(d.groupKey)) continue;
      seen.add(d.groupKey);
      hits.push({
        sourceId: 'ea-app',
        sourceGameId: g.path,
        title: d.base,
        groupKey: d.groupKey,
        edition: d.edition,
        platform: 'pc',
      });
      if (hits.length >= MAX_HITS) break;
    }
    return hits;
  },

  /** Exactly one offer: what EA charges from here, in the currency it bills. */
  async getOffers(sourceGameId: string): Promise<Offer[]> {
    if (!/^games\/[\w./-]+$/.test(sourceGameId)) return []; // ids are catalog paths
    const page = await readBuyPage(sourceGameId);
    if (!page || !page.onEaApp) return [];

    const currency = page.price.currency?.trim();
    if (!currency || !(await canConvert(currency))) return [];
    const shown = page.price.displayTotalWithDiscount ?? page.price.displayTotal;
    const value = shown ? parseLocalizedPrice(shown) : null;
    if (value == null || !(value > 0)) return []; // free / subscription-only / unpriced

    const listed = page.price.displayTotal ? parseLocalizedPrice(page.price.displayTotal) : null;
    const onSale = listed != null && listed > value;
    const pct = page.price.discountPercentage;
    return [
      {
        store: 'EA App',
        kind: 'digital',
        location: 'international',
        price: value,
        currency,
        priceILS: await toILS(value, currency),
        retailPrice: onSale ? listed : undefined,
        savings: onSale
          ? Math.round(((listed - value) / listed) * 100)
          : typeof pct === 'number' && pct > 0
            ? Math.round(pct)
            : undefined,
        url: ORIGIN + '/' + sourceGameId + '/buy',
      },
    ];
  },
};
