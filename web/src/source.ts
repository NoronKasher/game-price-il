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
