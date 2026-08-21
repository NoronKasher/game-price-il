import type { GameHit, Offer, SourceAdapter } from './types.ts';
import { toILS, canConvert } from '../rates.ts';
import { describeProduct } from '../normalize.ts';
import { REGIONS } from '../regions.ts';

/**
 * Epic Games Store — regional price board for PC games.
 *
 * Epic's own store API sits behind Cloudflare bot-management that blocks
 * server-side clients outright (a 403 challenge, not just an empty result), and
 * this project does not defeat bot protection. So — exactly as it already does
 * for PC with CheapShark/ITAD — it reads Epic prices through a public
 * third-party aggregator, egdata.app, which mirrors the Epic catalog as clean
 * JSON: `/autocomplete` for discovery and `/offers/{id}/price?country=XX` for a
 * single game's price in one region. A game's Epic offer id is stable across
 * regions, so pricing is a direct lookup per region — no re-search, no matching.
 *
 * sourceGameId = "<offerId>~<url-encoded name>".
 */

const BASE = 'https://api.egdata.app';
const UA = 'GamePriceIL/0.1 (personal wishlist price tracker for Israel)';
const CACHE_TTL = 10 * 60 * 1000;
const MAX_CONCURRENT = 6;

// Epic stores prices in the currency's minor units, EXCEPT these, which it keeps
// as whole units — verified by USD-anchoring egdata's values (getting this wrong
// is a silent 100× error). Every other currency we use, including officially
// zero-decimal CLP/COP/IDR, is scaled by 100.
const WHOLE_UNIT = new Set(['JPY', 'KRW', 'VND']);
function toMajor(minor: number, currency: string): number {
  return WHOLE_UNIT.has(currency) ? minor : minor / 100;
}

interface EgdataElement {
  title: string;
  id: string;
  namespace: string;
  offerType?: string;
  keyImages?: { type: string; url: string }[];
}
interface EgdataPrice {
  price?: { currencyCode?: string; discountPrice?: number; originalPrice?: number };
}

const cache = new Map<string, { body: string; at: number }>();
async function getJson<T>(path: string): Promise<T | null> {
  const c = cache.get(path);
  if (!c || Date.now() - c.at >= CACHE_TTL) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      cache.set(path, { body: await res.text(), at: Date.now() });
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(cache.get(path)!.body) as T;
  } catch {
    return null;
  }
}

/** Prefer a wide cover image, falling back to whatever art egdata returns. */
function imageOf(el: EgdataElement): string | undefined {
  const pref = ['OfferImageWide', 'DieselStoreFrontWide', 'Featured', 'Thumbnail', 'OfferImageTall'];
  const imgs = el.keyImages ?? [];
  for (const t of pref) {
    const hit = imgs.find((k) => k.type === t);
    if (hit?.url) return hit.url;
  }
  return imgs[0]?.url;
}

export const epic: SourceAdapter = {
  id: 'epic-games',
  name: 'Epic Games Store (regional)',
  nameHe: 'אפיק גיימס — לפי אזור',
  platforms: ['pc'],
  healthProbe: 'stray',
  enabled: true,

  async search(title: string): Promise<GameHit[]> {
    const data = await getJson<{ elements?: EgdataElement[] }>(
      `/autocomplete?query=${encodeURIComponent(title)}&limit=20`
    );
    const hits: GameHit[] = [];
    const seen = new Set<string>();
    for (const el of data?.elements ?? []) {
      // Keep games and editions of games; drop DLC, add-ons, soundtracks and
      // the OTHERS grab-bag (free trials live there). Editions have to be kept:
      // egdata's catalog often carries no BASE_GAME row for a title at all —
      // Far Cry 6 exists only as "Far Cry 6 Ultimate Edition" — and requiring
      // BASE_GAME silently dropped Epic from those games' boards entirely. An
      // edition groups onto the same game and prices like any other row.
      if (el.offerType !== 'BASE_GAME' && el.offerType !== 'EDITION') continue;
      if (!el.id) continue;
      const d = describeProduct(el.title);
      if (d.accessory) continue;
      if (seen.has(el.id)) continue;
      seen.add(el.id);
      hits.push({
        sourceId: 'epic-games',
        sourceGameId: `${el.id}~${encodeURIComponent(d.base || el.title)}`,
        title: d.base || el.title,
        groupKey: d.groupKey,
        edition: d.edition,
        image: imageOf(el),
        platform: 'pc',
      });
    }
    return hits;
  },

  /** One offer per region, priced directly by the game's stable Epic offer id. */
  async getOffers(sourceGameId: string): Promise<Offer[]> {
    const [id, encodedName] = sourceGameId.split('~');
    const name = decodeURIComponent(encodedName ?? '');
    if (!id) return [];

    const results: (Offer | null)[] = [];
    let i = 0;
    async function worker() {
      while (i < REGIONS.length) {
        const region = REGIONS[i++]!;
        results.push(await offerForRegion(region));
      }
    }
    async function offerForRegion(region: (typeof REGIONS)[number]): Promise<Offer | null> {
      const data = await getJson<EgdataPrice>(`/offers/${id}/price?country=${region.market}`);
      const p = data?.price;
      if (!p?.currencyCode || p.discountPrice == null) return null;
      const native = toMajor(p.discountPrice, p.currencyCode);
      if (!(native > 0)) return null; // free / unpriced / not sold here
      if (!(await canConvert(p.currencyCode))) return null;
      const regular = p.originalPrice != null ? toMajor(p.originalPrice, p.currencyCode) : native;
      const onSale = regular > native;
      return {
        store: `Epic ${region.flag}`,
        kind: 'digital',
        location: region.market === 'IL' ? 'israel' : 'international',
        price: native,
        currency: p.currencyCode,
        priceILS: await toILS(native, p.currencyCode),
        retailPrice: onSale ? regular : undefined,
        savings: onSale ? Math.round(((regular - native) / regular) * 100) : undefined,
        region: region.market,
        regionName: region.nameHe,
        flag: region.flag,
        pinned: region.pinned,
        url: `https://store.epicgames.com/en-US/browse?q=${encodeURIComponent(name)}&sortBy=relevancy`,
      };
    }
    await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, REGIONS.length) }, worker));

    return results.filter((o): o is Offer => o !== null).sort((a, b) => a.priceILS - b.priceILS);
  },
};
