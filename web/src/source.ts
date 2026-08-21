import { regionByMarket } from './regions';

/**
 * Naming a price's source, readably.
 *
 * Adapters bake decoration into the store name they record — a flag emoji
 * ("Steam 🇺🇸", "PS Store 🇬🇧") and sometimes the bucket label itself
 * ("מוכרי מפתחות · GG.deals"). The UI then printed the type label and the region
 * flag alongside it, so a single line read "Steam us $59.99 US": the region
 * twice, the kind twice, and neither as a word.
 *
 * Worse, regional-indicator flags DON'T RENDER on Windows — they degrade to the
 * two letters of the country code. So the flag isn't a picture there, it's noise
 * that looks like part of the store's name. We therefore strip the decoration and
 * name the region in Hebrew, which reads correctly on every platform.
 */

/** Pairs of regional-indicator codepoints — i.e. an emoji flag. */
const FLAG = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
/** Bucket labels some adapters prefix onto the store name; we render our own. */
const KIND_PREFIX = /^\s*(מוכרי מפתחות|חנות רשמית|דיסק)\s*[·|\-–:]\s*/;

/** The store's own name, without the flag/kind decoration baked in by adapters. */
export function cleanStoreName(store: string): string {
  return store
    .replace(FLAG, '')
    .replace(KIND_PREFIX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The region's Hebrew name ("ארה״ב"), or the raw code if we don't know it. */
export function regionLabel(region: string | null | undefined): string | null {
  if (!region) return null;
  return regionByMarket.get(region)?.nameHe ?? region;
}

/**
 * How a price's origin should read: the store, plus the region when the price is
 * region-specific ("Steam · ארה״ב"). Used for both the visible label and tooltips.
 */
export function sourceLabel(store: string, region?: string | null): string {
  const name = cleanStoreName(store);
  const place = regionLabel(region);
  return place ? `${name} · ${place}` : name;
}

/**
 * The storefront a price belongs to, independent of which region or which
 * aggregator reported it.
 *
 * One storefront reaches the board under several names — Steam arrives 30 times
 * as "Steam 🇺🇸".."Steam 🇯🇵", and Ubisoft arrives both from our own regional
 * adapter ("Ubisoft 🇹🇷") and from CheapShark under its old brand ("Uplay").
 * Folding those into one family is what lets a single chip hide all of them, and
 * is why the test is on the name rather than the adapter id.
 *
 * Anything unrecognised becomes its own family under its own name, so a keyshop
 * we've never heard of is still filterable and never silently lumped in.
 */
const FAMILIES: { key: string; label: string; test: RegExp }[] = [
  { key: 'steam', label: 'Steam', test: /\bsteam\b/i },
  { key: 'epic', label: 'Epic Games', test: /\bepic\b/i },
  { key: 'ubisoft', label: 'Ubisoft Connect', test: /\bubisoft\b|\buplay\b/i },
  { key: 'ea', label: 'EA App', test: /\bea(\s*app)?\b|\borigin\b/i },
  { key: 'gog', label: 'GOG', test: /\bgog\b/i },
  { key: 'playstation', label: 'PlayStation Store', test: /\bps\s*store\b|playstation/i },
  { key: 'xbox', label: 'Xbox Store', test: /\bxbox\b|microsoft/i },
  { key: 'nintendo', label: 'Nintendo eShop', test: /\beshop\b|nintendo/i },
  { key: 'battlenet', label: 'Battle.net', test: /battle\.?net|blizzard/i },
];

/**
 * Families where the user buys from the platform ITSELF — the purchase lands in
 * their library directly, so there is no separate key to be locked to a country.
 * Everything else on the board (GMG, Fanatical, Humble, GG.deals, the ITAD
 * keyshops…) delivers a KEY, and a key can be region-restricted no matter where
 * it was bought. That distinction drives the caveat badges in regionRisk.ts, so
 * it lives here beside the names it's derived from.
 *
 * GOG counts as direct: its purchases are DRM-free, not keys for another store.
 */
const DIRECT_PURCHASE = new Set([
  'steam',
  'epic',
  'ubisoft',
  'ea',
  'gog',
  'playstation',
  'xbox',
  'nintendo',
  'battlenet',
]);

export interface StoreFamily {
  key: string;
  label: string;
}

export function storeFamily(store: string): StoreFamily {
  const name = cleanStoreName(store);
  for (const f of FAMILIES) {
    if (f.test.test(name)) return { key: f.key, label: f.label };
  }
  return { key: `x:${name.toLowerCase()}`, label: name };
}

/** True when buying here puts the game straight in the user's library (no key). */
export function isDirectPurchase(familyKey: string): boolean {
  return DIRECT_PURCHASE.has(familyKey);
}
