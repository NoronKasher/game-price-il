/**
 * CheapShark's store registry, shared by the adapters that need to know which
 * shops CheapShark actually serves.
 *
 * It lives apart from the CheapShark adapter so that ITAD can consult it without
 * the two adapters importing each other, and because the list is a moving
 * target: CheapShark deactivates storefronts as they shut down (Origin went
 * `isActive: 0` when EA retired it) and the ITAD adapter must react to that, not
 * to a list someone typed once.
 */

/** CheapShark rejects requests without a descriptive User-Agent (HTTP 400). */
export const CHEAPSHARK_HEADERS = {
  'User-Agent': 'GamePriceIL/0.1 (personal game price tracker; noron10@gmail.com)',
};

const BASE = 'https://www.cheapshark.com/api/1.0';

export interface CsStore {
  storeID: string;
  storeName: string;
  isActive: number;
  images: { logo: string; icon: string };
}

/** Lowercase + strip non-alphanumerics so "Green Man Gaming" == "GreenManGaming". */
export function normShop(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

let storeCache: Map<string, CsStore> | null = null;

export async function getStores(): Promise<Map<string, CsStore>> {
  if (storeCache) return storeCache;
  const res = await fetch(`${BASE}/stores`, { headers: CHEAPSHARK_HEADERS });
  if (!res.ok) throw new Error(`cheapshark stores ${res.status}`);
  const stores = (await res.json()) as CsStore[];
  storeCache = new Map(stores.map((s) => [s.storeID, s]));
  return storeCache;
}

/**
 * Normalized names of the storefronts CheapShark is *currently* serving prices
 * for — i.e. the rows another aggregator would only duplicate.
 *
 * Returns null (not an empty set) when the list can't be fetched, so a caller
 * can tell "CheapShark covers nothing" apart from "we don't know yet" and fall
 * back to its own conservative list instead of un-suppressing everything.
 */
export async function activeShopKeys(): Promise<Set<string> | null> {
  try {
    const stores = await getStores();
    const keys = new Set<string>();
    for (const s of stores.values()) if (s.isActive) keys.add(normShop(s.storeName));
    return keys.size > 0 ? keys : null;
  } catch {
    return null;
  }
}
