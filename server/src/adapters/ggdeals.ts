import type { GameHit, Offer, SourceAdapter } from './types.ts';
import { toILS } from '../rates.ts';
import { getApiKey, hasApiKey } from '../keys.ts';

/**
 * GG.deals — keyshop (external supplier) prices.
 *
 * GG.deals is a price aggregator that, unlike IsThereAnyDeal/CheapShark,
 * DOES cover the grey-market key marketplaces the user asked for (G2A,
 * Kinguin, Eneba, Gamivo, Driffle…). Its API is free for personal use but
 * requires a key the user registers at https://gg.deals/settings/api/ (same
 * model as IsThereAnyDeal). Until a key is provided this adapter stays
 * disabled and nothing changes.
 *
 * Endpoint (verified): https://api.gg.deals/v1/prices/by-steam-app-id/?ids=<appId>&key=<key>
 * Discovery: CheapShark emits a companion hit carrying the Steam appID.
 * sourceGameId = Steam appID.
 *
 * NOTE: the exact JSON field names are parsed defensively and should be
 * confirmed against a real key before relying on them.
 */

// The key is resolved at request time from the settings table / env / file (see
// keys.ts), so a key added in the setup screen takes effect without a rebuild.
const API = 'https://api.gg.deals/v1/prices/by-steam-app-id/';
/** GG.deals returns prices in the account's configured currency; default USD. */
const ACCOUNT_CURRENCY = process.env.GG_DEALS_CURRENCY?.trim() || 'USD';

/** Pull a numeric price out of whatever shape the field takes ("9.99", 9.99, {price}). */
function num(v: unknown): number | null {
  if (typeof v === 'number' && v > 0) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  if (v && typeof v === 'object') {
    for (const k of ['price', 'amount', 'value', 'current']) {
      const n = num((v as Record<string, unknown>)[k]);
      if (n != null) return n;
    }
  }
  return null;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (obj[k] != null) return obj[k];
  return null;
}

export const ggdeals: SourceAdapter = {
  id: 'ggdeals',
  name: 'GG.deals (keyshops)',
  nameHe: 'GG.deals — מוכרי מפתחות',
  platforms: ['pc'],
  get enabled() {
    return hasApiKey('ggdeals');
  },

  // Discovery via CheapShark's companion hit.
  async search(): Promise<GameHit[]> {
    return [];
  },

  async getOffers(sourceGameId: string): Promise<Offer[]> {
    const apiKey = getApiKey('ggdeals');
    if (!apiKey) return [];
    const res = await fetch(`${API}?ids=${encodeURIComponent(sourceGameId)}&key=${apiKey}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`ggdeals ${res.status}`);
    const body = (await res.json()) as { data?: Record<string, unknown> };
    const entry = body.data?.[sourceGameId];
    if (!entry || typeof entry !== 'object') return [];

    const prices = (('prices' in entry ? (entry as Record<string, unknown>).prices : entry) ??
      {}) as Record<string, unknown>;
    const url =
      (pick(entry as Record<string, unknown>, ['url', 'gg_url']) as string | null) ?? undefined;
    // Currency comes back in the response; fall back to the configured default.
    const currency = (pick(prices, ['currency']) as string | null)?.trim() || ACCOUNT_CURRENCY;

    // GG.deals' unique value is the cheapest KEYSHOP price (G2A/Kinguin/Eneba…),
    // which CheapShark/ITAD don't cover. Retail overlaps CheapShark, so we skip
    // it. The `url` links to GG.deals' full per-shop breakdown.
    const keyshop = num(pick(prices, ['currentKeyshops', 'currentKeyshopsPrice', 'keyshops']));
    if (keyshop == null) return [];
    return [
      {
        store: 'מוכרי מפתחות · GG.deals',
        kind: 'digital',
        location: 'international',
        price: keyshop,
        currency,
        priceILS: await toILS(keyshop, currency),
        url,
      },
    ];
  },
};
