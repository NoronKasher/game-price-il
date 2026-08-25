import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { toILS, canConvert } from '../rates.ts';
import { REGIONS } from '../regions.ts';
import { describeProduct } from '../normalize.ts';

/**
 * Nintendo eShop — regional price board, multi-cluster.
 *
 * Nintendo assigns a *different* product id (nsuid) per region cluster, and
 * each cluster has its own public search backend. We query both and merge, so
 * one game carries an Americas nsuid AND a Europe nsuid; prices then come from
 * Nintendo's own public price API (api.ec.nintendo.com), which is shared by
 * all clusters. Everything here is a first-party Nintendo endpoint — no
 * scraping, no bot-protection to work around.
 *
 *   Americas search: Algolia index store_game_en_us
 *                    → prices in US, CA, MX, BR, AR, CL, CO, PE
 *   Europe search:   search.nintendo-europe.com (Solr)
 *                    → prices in GB, ZA, IL, UA (+ EU), incl. an Israel EUR price
 *
 * (Turkey/India have no Nintendo eShop; Japan is a third cluster — those
 * regions simply return no price and are skipped.)
 *
 * sourceGameId = "<americasNsuid>~<europeNsuid>" (either side may be empty).
 */

// ── Americas: Algolia ──
const ALGOLIA_APP = 'U3B6GR4UA3';
const ALGOLIA_KEY = 'a29c6927638bfd8cee23993e51e721c9';
const ALGOLIA_URL = `https://${ALGOLIA_APP.toLowerCase()}-dsn.algolia.net/1/indexes/store_game_en_us/query`;
const AMERICAS_MARKETS = new Set(['US', 'CA', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE']);

// ── Europe: Solr ──
const EU_SEARCH = 'https://search.nintendo-europe.com/en/select';
const EUROPE_MARKETS = new Set(['GB', 'ZA', 'IL', 'UA']);

const PRICE_API = 'https://api.ec.nintendo.com/v1/price';

interface AlgoliaHit {
  title: string;
  nsuid?: string;
  /** Ready-made cover URL. Explicitly null on most of the catalogue. */
  productImageSquare?: string | null;
  /** Cloudinary public id for the same art — present even when the URL isn't. */
  productImage?: string | null;
}
interface SolrDoc {
  title: string;
  nsuid_txt?: string[];
  image_url?: string;
  image_url_sq_s?: string;
  image_url_h2x1_s?: string;
  image_url_h16x9_s?: string;
}
interface NintendoPrice {
  title_id: number;
  regular_price?: { amount: string; currency: string; raw_value: string };
  discount_price?: { amount: string; currency: string; raw_value: string };
}

/** One merged game across the two search clusters. */
interface Merged {
  title: string;
  edition: string | null;
  image?: string;
  americas?: string; // nsuid
  europe?: string; // nsuid
}

/**
 * Nintendo's own image CDN, with the transform the eShop itself asks for.
 *
 * Americas listings carry their art twice: `productImageSquare` is a finished
 * delivery URL, but it comes back null on most of the catalogue, while
 * `productImage` — the Cloudinary public id that same URL is built from — is
 * always there. Assembling the URL from the id yields the identical
 * first-party picture, so a null square costs the game nothing.
 */
const ASSETS = 'https://assets.nintendo.com/image/upload/q_auto/f_auto';

/** Cover art for an Americas (Algolia) listing. */
function americasImage(h: AlgoliaHit): string | undefined {
  if (h.productImageSquare) return h.productImageSquare;
  return h.productImage ? `${ASSETS}/${h.productImage}` : undefined;
}

/**
 * Cover art for a Europe (Solr) listing.
 *
 * `image_url` alone — the only field this used to read — is absent from every
 * recently added game, Switch 2 titles included, which is why half of a
 * results grid came back as bare text boxes. `image_url_sq_s` is the square
 * box art the eShop prints on its own tiles, so it leads; the wide banners
 * cover the older entries that have no square.
 */
function europeImage(doc: SolrDoc): string | undefined {
  return doc.image_url_sq_s || doc.image_url || doc.image_url_h2x1_s || doc.image_url_h16x9_s || undefined;
}

const priceCache = new Map<string, { price: NintendoPrice | null; at: number }>();
const PRICE_TTL = 30 * 60 * 1000;

async function fetchPrice(country: string, nsuid: string): Promise<NintendoPrice | null> {
  const key = `${country}:${nsuid}`;
  const hit = priceCache.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL) return hit.price;
  try {
    // nsuid comes from a wishlist ref (possibly imported) — encode it so a
    // crafted value can't inject extra query parameters.
    const res = await fetch(`${PRICE_API}?country=${country}&lang=en&ids=${encodeURIComponent(nsuid)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const price = res.ok ? ((await res.json()) as { prices?: NintendoPrice[] }).prices?.[0] ?? null : null;
    priceCache.set(key, { price, at: Date.now() });
    return price;
  } catch {
    return null;
  }
}

async function searchAmericas(title: string): Promise<AlgoliaHit[]> {
  try {
    const res = await fetch(ALGOLIA_URL, {
      method: 'POST',
      headers: {
        'X-Algolia-API-Key': ALGOLIA_KEY,
        'X-Algolia-Application-Id': ALGOLIA_APP,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: title, hitsPerPage: 24 }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? ((await res.json()) as { hits?: AlgoliaHit[] }).hits ?? [] : [];
  } catch {
    return [];
  }
}

async function searchEurope(title: string): Promise<SolrDoc[]> {
  try {
    const url = `${EU_SEARCH}?q=${encodeURIComponent(title)}&fq=type:GAME&rows=24&wt=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    return res.ok ? ((await res.json()) as { response?: { docs?: SolrDoc[] } }).response?.docs ?? [] : [];
  } catch {
    return [];
  }
}

export const nintendo: SourceAdapter = {
  id: 'nintendo-eshop',
  name: 'Nintendo eShop (regional)',
  nameHe: 'חנות נינטנדו — לפי אזור',
  platforms: ['switch'],
  enabled: true,

  async search(title: string): Promise<GameHit[]> {
    const [amHits, euDocs] = await Promise.all([searchAmericas(title), searchEurope(title)]);

    const merged = new Map<string, Merged>();
    for (const h of amHits) {
      if (!h.nsuid) continue;
      const d = describeProduct(h.title);
      if (d.accessory) continue;
      const m = merged.get(d.groupKey) ?? { title: d.base || h.title, edition: d.edition };
      m.americas = h.nsuid;
      m.image ??= americasImage(h);
      merged.set(d.groupKey, m);
    }
    for (const doc of euDocs) {
      const nsuid = doc.nsuid_txt?.find((n) => /^\d+$/.test(n));
      if (!nsuid) continue;
      const d = describeProduct(doc.title);
      if (d.accessory) continue;
      const m = merged.get(d.groupKey) ?? { title: d.base || doc.title, edition: d.edition };
      m.europe = nsuid;
      m.image ??= europeImage(doc);
      merged.set(d.groupKey, m);
    }

    const hits: GameHit[] = [];
    for (const [groupKey, m] of merged) {
      if (!m.americas && !m.europe) continue;
      hits.push({
        sourceId: 'nintendo-eshop',
        sourceGameId: `${m.americas ?? ''}~${m.europe ?? ''}`,
        title: m.title,
        groupKey,
        edition: m.edition,
        image: m.image,
        platform: 'switch' as Platform,
      });
    }
    return hits;
  },

  /** One offer per region across both clusters, cheapest ₪ first. */
  async getOffers(sourceGameId: string): Promise<Offer[]> {
    const [americas, europe] = sourceGameId.split('~');

    const results = await Promise.all(
      REGIONS.map(async (region) => {
        let nsuid: string | undefined;
        if (AMERICAS_MARKETS.has(region.market)) nsuid = americas || undefined;
        else if (EUROPE_MARKETS.has(region.market)) nsuid = europe || undefined;
        if (!nsuid) return null;

        const p = await fetchPrice(region.market, nsuid);
        const chosen = p?.discount_price ?? p?.regular_price;
        if (!chosen) return null;
        const native = Number(chosen.raw_value);
        if (!Number.isFinite(native) || native <= 0) return null;
        if (!(await canConvert(chosen.currency))) return null;

        const regular = p?.regular_price ? Number(p.regular_price.raw_value) : native;
        const onSale = !!p?.discount_price && regular > native;
        const offer: Offer = {
          store: `Nintendo ${region.flag}`,
          kind: 'digital',
          location: region.market === 'IL' ? 'israel' : 'international',
          price: native,
          currency: chosen.currency,
          priceILS: await toILS(native, chosen.currency),
          retailPrice: onSale ? regular : undefined,
          savings: onSale ? Math.round(((regular - native) / regular) * 100) : undefined,
          region: region.market,
          regionName: region.nameHe,
          flag: region.flag,
          pinned: region.pinned,
          url: `https://www.nintendo.com/${region.market.toLowerCase()}/store/products/`,
        };
        return offer;
      })
    );
    return results.filter((o): o is Offer => o !== null).sort((a, b) => a.priceILS - b.priceILS);
  },
};
