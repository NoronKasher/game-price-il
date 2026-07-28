import type { GameHit, Offer, SourceAdapter } from './types.ts';
import type { Platform } from '../search.ts';
import { toILS } from '../rates.ts';
import { describeProduct } from '../normalize.ts';
import { ggdeals } from './ggdeals.ts';
import { itad } from './itad.ts';

/**
 * CheapShark — free, keyless aggregator of ~30 PC digital stores (Steam, GOG,
 * Epic, Fanatical, GMG...). Prices are in USD. https://apidocs.cheapshark.com/
 */

const BASE = 'https://www.cheapshark.com/api/1.0';

/** CheapShark now rejects requests without a descriptive User-Agent (HTTP 400). */
export const CHEAPSHARK_HEADERS = {
  'User-Agent': 'GamePriceIL/0.1 (personal game price tracker; noron10@gmail.com)',
};

interface CsGame {
  gameID: string;
  external: string;
  steamAppID: string | null;
  thumb: string;
  cheapest: string;
}

interface CsStore {
  storeID: string;
  storeName: string;
  isActive: number;
  images: { logo: string; icon: string };
}

interface CsDeal {
  storeID: string;
  dealID: string;
  price: string;
  retailPrice: string;
  savings: string;
}

let storeCache: Map<string, CsStore> | null = null;

async function getStores(): Promise<Map<string, CsStore>> {
  if (storeCache) return storeCache;
  const res = await fetch(`${BASE}/stores`, { headers: CHEAPSHARK_HEADERS });
  if (!res.ok) throw new Error(`cheapshark stores ${res.status}`);
  const stores = (await res.json()) as CsStore[];
  storeCache = new Map(stores.map((s) => [s.storeID, s]));
  return storeCache;
}

/** Steam header art is much nicer than CheapShark's tiny thumb. */
function bestImage(g: CsGame): string {
  if (g.steamAppID) {
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steamAppID}/header.jpg`;
  }
  return g.thumb;
}

export const cheapshark: SourceAdapter = {
  id: 'cheapshark',
  name: 'CheapShark (PC digital)',
  nameHe: 'חנויות דיגיטליות למחשב',
  platforms: ['pc'],
  enabled: true,

  async search(title: string): Promise<GameHit[]> {
    const res = await fetch(`${BASE}/games?title=${encodeURIComponent(title)}&limit=24`, {
      headers: CHEAPSHARK_HEADERS,
    });
    if (!res.ok) throw new Error(`cheapshark search ${res.status}`);
    const games = (await res.json()) as CsGame[];
    const hits: GameHit[] = [];
    for (const g of games) {
      const d = describeProduct(g.external);
      const base = {
        title: d.base,
        groupKey: d.groupKey,
        edition: d.edition,
        image: bestImage(g),
        platform: 'pc' as Platform,
      };
      // The reseller / key-store list.
      hits.push({ ...base, sourceId: 'cheapshark', sourceGameId: g.gameID });
      // A companion hit so Steam's per-region price board is available for PC too.
      if (g.steamAppID) {
        hits.push({ ...base, sourceId: 'steam-regional', sourceGameId: g.steamAppID });
        // Keyshop prices via GG.deals, when the user has configured an API key.
        if (ggdeals.enabled) {
          hits.push({ ...base, sourceId: 'ggdeals', sourceGameId: g.steamAppID });
        }
        // Wider shop+keyshop coverage via IsThereAnyDeal, when a key is configured.
        if (itad.enabled) {
          hits.push({ ...base, sourceId: 'itad', sourceGameId: g.steamAppID });
        }
      }
    }
    return hits;
  },

  async getOffers(sourceGameId: string): Promise<Offer[]> {
    const [res, stores] = await Promise.all([
      fetch(`${BASE}/games?id=${encodeURIComponent(sourceGameId)}`, { headers: CHEAPSHARK_HEADERS }),
      getStores(),
    ]);
    if (!res.ok) throw new Error(`cheapshark game ${res.status}`);
    const data = (await res.json()) as { deals: CsDeal[] };
    const offers: Offer[] = [];
    for (const deal of data.deals) {
      const store = stores.get(deal.storeID);
      if (!store || !store.isActive) continue;
      const price = Number(deal.price);
      offers.push({
        store: store.storeName,
        storeLogo: `https://www.cheapshark.com${store.images.logo}`,
        kind: 'digital',
        location: 'international',
        price,
        currency: 'USD',
        priceILS: await toILS(price, 'USD'),
        retailPrice: Number(deal.retailPrice),
        savings: Math.round(Number(deal.savings)),
        url: `https://www.cheapshark.com/redirect?dealID=${deal.dealID}`,
      });
    }
    return offers.sort((a, b) => a.priceILS - b.priceILS);
  },
};
