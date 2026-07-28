import type { GameHit, Offer, SourceAdapter } from './types.ts';
import { toILS } from '../rates.ts';
import { getApiKey, hasApiKey } from '../keys.ts';

/**
 * IsThereAnyDeal (ITAD) — the widest legit PC price aggregator.
 *
 * ITAD's v2 API tracks *dozens* of shops in one place: the official stores
 * CheapShark already covers (Steam/GOG/Epic/Fanatical/Humble…) AND the grey
 * keyshops (G2A, Kinguin, Eneba, Gamivo, CDKeys…) that CheapShark does not.
 * Adding it roughly doubles digital-PC shop coverage and cross-checks the
 * others. Like GG.deals it's free for personal use but needs a key the user
 * registers at https://isthereanydeal.com/apps/ — until a key is present this
 * adapter stays disabled and nothing changes.
 *
 * Endpoints (verified against docs.isthereanydeal.com, API v2):
 *   1. lookup:  GET  https://api.isthereanydeal.com/games/lookup/v1?appid=<steamAppId>&key=<key>
 *               → { found, game: { id (uuid), slug, title, ... } }
 *   2. prices:  POST https://api.isthereanydeal.com/games/prices/v3?country=US&capacity=20&key=<key>
 *               body: ["<game-uuid>"]   (array of ids, 1-200)
 *               → [ { id, historyLow, deals: [ { shop:{id,name}, price:{amount,currency},
 *                     regular:{amount,...}, cut, url, ... } ] } ]
 *
 * Discovery mirrors GG.deals: CheapShark emits a companion hit carrying the
 * Steam appID, so `sourceGameId` here is the Steam appID and we resolve it to
 * an ITAD game-uuid on demand (cached).
 */

// The key is resolved at request time from the settings table / env / file (see
// keys.ts), so a key added in the setup screen takes effect without a rebuild.
const LOOKUP = 'https://api.isthereanydeal.com/games/lookup/v1';
const PRICES = 'https://api.isthereanydeal.com/games/prices/v3';
/** Two-letter country → picks the pricing currency. US keeps everything in USD,
 *  matching CheapShark/GG.deals so the external-suppliers board stays uniform. */
const COUNTRY = process.env.ITAD_COUNTRY?.trim() || 'US';
/** Courtesy identifier — this is an official API, but polite clients name themselves. */
const HEADERS = {
  'User-Agent': 'GamePriceIL/0.1 (personal game price tracker; noron10@gmail.com)',
  'Content-Type': 'application/json',
};

/** Cap on how many ITAD rows we contribute so the board never floods. */
const MAX_OFFERS = 12;

/**
 * Shops CheapShark already surfaces (normalised names). We SKIP these so ITAD
 * doesn't duplicate CheapShark's official-store rows in the same board — ITAD's
 * distinctive value is the *other* shops (keyshops + niche stores CheapShark
 * misses). CheapShark stays the source of truth for the mainstream storefronts;
 * the merged board still cross-checks at the cheapest-overall level. GG.deals'
 * single cheapest-keyshop line and ITAD's per-keyshop breakdown complement (not
 * duplicate) each other. Keep in rough sync with CheapShark's active store list.
 */
const CHEAPSHARK_COVERED = new Set(
  [
    'steam',
    'gog',
    'epicgamestore',
    'epicgames',
    'humblestore',
    'humble',
    'humblebundle',
    'fanatical',
    'greenmangaming',
    'gamesplanet',
    'gamebillet',
    'voidu',
    'wingamestore',
    'indiegala',
    '2game',
    'gamersgate',
    'allyouplay',
    'dlgamer',
    'noctre',
    'dreamgame',
    'gamestop',
    'gamesrocket',
    'gamesload',
    'razergamestore',
    'blizzard',
    'battlenet',
    'microsoftstore',
    'xboxstore',
    'ea',
    'eaapp',
    'origin',
    'ubisoftstore',
    'ubisoftconnect',
    'uplay',
    'amazon',
  ].map(normShop)
);

/** Lowercase + strip non-alphanumerics so "Green Man Gaming" == "GreenManGaming". */
function normShop(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Resolve Steam appId → ITAD game-uuid, cached per process (null = looked up, none found). */
const idCache = new Map<string, string | null>();

async function resolveGameId(steamAppId: string, apiKey: string): Promise<string | null> {
  const cached = idCache.get(steamAppId);
  if (cached !== undefined) return cached;
  const url = `${LOOKUP}?appid=${encodeURIComponent(steamAppId)}&key=${apiKey}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`itad lookup ${res.status}`);
  const body = (await res.json()) as { found?: boolean; game?: { id?: string } };
  const id = body.found && body.game?.id ? body.game.id : null;
  idCache.set(steamAppId, id);
  return id;
}

interface ItadMoney {
  amount?: number;
  currency?: string;
}
interface ItadDeal {
  shop?: { id?: number; name?: string };
  price?: ItadMoney;
  regular?: ItadMoney;
  cut?: number;
  url?: string;
}
interface ItadPriceEntry {
  id?: string;
  deals?: ItadDeal[];
}

export const itad: SourceAdapter = {
  id: 'itad',
  name: 'IsThereAnyDeal',
  nameHe: 'IsThereAnyDeal — משווה מחירים',
  platforms: ['pc'],
  get enabled() {
    return hasApiKey('itad');
  },

  // Discovery via CheapShark's companion hit (sourceGameId = Steam appID).
  async search(): Promise<GameHit[]> {
    return [];
  },

  async getOffers(sourceGameId: string): Promise<Offer[]> {
    const apiKey = getApiKey('itad');
    if (!apiKey) return [];
    const gameId = await resolveGameId(sourceGameId, apiKey);
    if (!gameId) return [];

    const res = await fetch(
      `${PRICES}?country=${encodeURIComponent(COUNTRY)}&capacity=20&key=${apiKey}`,
      {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify([gameId]),
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) throw new Error(`itad prices ${res.status}`);
    const body = (await res.json()) as ItadPriceEntry[];
    const entry = Array.isArray(body)
      ? (body.find((e) => e.id === gameId) ?? body[0])
      : undefined;
    const deals = entry?.deals ?? [];

    // Keep the cheapest deal per shop, dropping shops CheapShark already covers.
    const cheapestPerShop = new Map<string, ItadDeal>();
    for (const d of deals) {
      const name = d.shop?.name?.trim();
      const amount = d.price?.amount;
      if (!name || typeof amount !== 'number' || !(amount > 0)) continue;
      if (CHEAPSHARK_COVERED.has(normShop(name))) continue;
      const prev = cheapestPerShop.get(name);
      if (!prev || (prev.price?.amount ?? Infinity) > amount) cheapestPerShop.set(name, d);
    }

    const ranked = [...cheapestPerShop.values()]
      .sort((a, b) => (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity))
      .slice(0, MAX_OFFERS);

    const offers: Offer[] = [];
    for (const d of ranked) {
      const name = d.shop!.name!.trim();
      const price = d.price!.amount!;
      // The response always carries the currency; USD is a safe last resort (COUNTRY=US).
      const currency = d.price?.currency?.trim() || 'USD';
      let priceILS: number;
      try {
        priceILS = await toILS(price, currency);
      } catch {
        continue; // currency we can't convert right now — skip rather than mislead
      }
      const regular = d.regular?.amount;
      offers.push({
        // Suffix names the aggregator, so an ITAD-only shop is clearly labelled.
        store: `${name} · ITAD`,
        kind: 'digital',
        location: 'international',
        price,
        currency,
        priceILS,
        retailPrice: typeof regular === 'number' && regular > price ? regular : undefined,
        savings: typeof d.cut === 'number' && d.cut > 0 ? Math.round(d.cut) : undefined,
        url: d.url,
      });
    }
    return offers;
  },
};
