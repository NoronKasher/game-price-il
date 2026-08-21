import type { GameHit, Offer, SourceAdapter } from './types.ts';
import { toILS, canConvert } from '../rates.ts';
import { REGIONS } from '../regions.ts';

/**
 * Steam — regional price board for PC games.
 *
 * Steam's own public store API returns a game's price in any country via the
 * `cc` parameter (store.steampowered.com/api/appdetails?appids=…&cc=XX). This
 * is first-party Steam data — the same prices the store shows — so PC games get
 * a real cross-region board just like consoles, with Israel priced natively in
 * ILS.
 *
 * Discovery: this adapter doesn't search on its own; the CheapShark adapter
 * already knows each game's Steam appID and emits a companion hit for it.
 * sourceGameId = Steam appID.
 */

const API = 'https://store.steampowered.com/api/appdetails';

interface PriceOverview {
  currency: string;
  initial: number; // cents
  final: number; // cents
  discount_percent: number;
}

const cache = new Map<string, { price: PriceOverview | null; at: number }>();
const TTL = 30 * 60 * 1000;

async function fetchRegionPrice(appId: string, cc: string): Promise<PriceOverview | null> {
  const key = `${appId}@${cc}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.price;
  let price: PriceOverview | null = null;
  try {
    // appId reaches us from a wishlist ref, which can come from an imported file —
    // encode it so a crafted value can't inject extra query parameters.
    const res = await fetch(`${API}?appids=${encodeURIComponent(appId)}&cc=${cc}&l=en&filters=price_overview`, {
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, { success: boolean; data?: { price_overview?: PriceOverview } }>;
      price = data[appId]?.data?.price_overview ?? null;
    }
  } catch {
    price = null;
  }
  cache.set(key, { price, at: Date.now() });
  return price;
}

/** Run region lookups with a small concurrency cap (Steam rate-limits per IP). */
async function pooled<T, R>(items: T[], fn: (t: T) => Promise<R>, limit = 4): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface SteamMeta {
  description: string;
  genres: string[];
  image?: string;
}

const metaCache = new Map<string, { meta: SteamMeta | null; at: number }>();

/** Game description + genres from Steam's own appdetails (free, no key). */
export async function steamMeta(appId: string): Promise<SteamMeta | null> {
  const hit = metaCache.get(appId);
  if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) return hit.meta;
  let meta: SteamMeta | null = null;
  try {
    const res = await fetch(
      `${API}?appids=${appId}&l=en&filters=basic,genres`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (res.ok) {
      const data = (await res.json()) as Record<
        string,
        { success: boolean; data?: { short_description?: string; genres?: { description: string }[]; header_image?: string } }
      >;
      const d = data[appId]?.data;
      if (d) {
        meta = {
          description: d.short_description ?? '',
          genres: (d.genres ?? []).map((g) => g.description),
          image: d.header_image,
        };
      }
    }
  } catch {
    meta = null;
  }
  metaCache.set(appId, { meta, at: Date.now() });
  return meta;
}

export const steamRegional: SourceAdapter = {
  id: 'steam-regional',
  name: 'Steam (regional)',
  nameHe: 'Steam — לפי אזור',
  platforms: ['pc'],
  companion: true,
  healthProbeId: '1245620',
  enabled: true,

  // Discovery happens via CheapShark's companion hit; no standalone search.
  async search(): Promise<GameHit[]> {
    return [];
  },

  async getOffers(sourceGameId: string): Promise<Offer[]> {
    const results = await pooled(REGIONS, async (region) => {
      const po = await fetchRegionPrice(sourceGameId, region.market.toLowerCase());
      if (!po?.currency) return null;
      const native = po.final / 100;
      if (native <= 0) return null;
      if (!(await canConvert(po.currency))) return null;
      const retail = po.initial / 100;
      const onSale = po.discount_percent > 0 && retail > native;
      const offer: Offer = {
        store: `Steam ${region.flag}`,
        kind: 'digital',
        location: region.market === 'IL' ? 'israel' : 'international',
        price: native,
        currency: po.currency,
        priceILS: await toILS(native, po.currency),
        retailPrice: onSale ? retail : undefined,
        savings: onSale ? po.discount_percent : undefined,
        region: region.market,
        regionName: region.nameHe,
        flag: region.flag,
        pinned: region.pinned,
        url: `https://store.steampowered.com/app/${sourceGameId}/?cc=${region.market.toLowerCase()}`,
      };
      return offer;
    });
    return results.filter((o): o is Offer => o !== null).sort((a, b) => a.priceILS - b.priceILS);
  },
};
