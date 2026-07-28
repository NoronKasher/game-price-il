import type { Platform } from '../search.ts';

/** Where the seller operates from, for the "local vs import" filter. */
export type SellerLocation = 'israel' | 'international';

/** Physical disc/cartridge vs digital key or store purchase. */
export type OfferKind = 'digital' | 'physical';

/** A game as returned by a source's search. */
export interface GameHit {
  /** Adapter id this hit came from. */
  sourceId: string;
  /** Stable key within the source, e.g. CheapShark gameID or product URL. */
  sourceGameId: string;
  /** Display title, platform words stripped. */
  title: string;
  /** Normalized key so the same game from different sources (and editions) groups together. */
  groupKey: string;
  /** Edition label ("Ultimate", "Collector's"…) or null for the base game. */
  edition: string | null;
  /** Cover / header image URL, if the source provides one. */
  image?: string;
  platform: Platform;
}

/** A single seller offer for a specific game+platform. */
export interface Offer {
  store: string;
  storeLogo?: string;
  kind: OfferKind;
  location: SellerLocation;
  /** Price in the seller's currency. */
  price: number;
  currency: string;
  /** Price converted to ILS (rounded to agorot). */
  priceILS: number;
  /** Full price before discount, same currency as `price`, if known. */
  retailPrice?: number;
  /** Discount percent 0-100, if known. */
  savings?: number;
  /** Region code for console stores (e.g. "TR", "US"); undefined for region-free PC keys. */
  region?: string;
  /** Hebrew region name for the region board, when this offer is region-specific. */
  regionName?: string;
  /** Flag emoji for the region board. */
  flag?: string;
  /** Whether this region is one of the user's pinned favorites (sorts to the top group). */
  pinned?: boolean;
  url?: string;
}

/**
 * A price source. Each store/API we track implements this interface;
 * new sources plug in without touching the rest of the app.
 */
export interface SourceAdapter {
  id: string;
  name: string;
  nameHe: string;
  platforms: Platform[];
  /** True once the adapter has a working implementation. */
  enabled: boolean;
  search(title: string, platforms: Platform[]): Promise<GameHit[]>;
  getOffers(sourceGameId: string, platform: Platform): Promise<Offer[]>;
}
