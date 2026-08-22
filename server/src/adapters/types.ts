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
  /**
   * Add-on content rather than a game. Only ever reaches the client when the
   * user has explicitly asked to see add-ons, and is badged when it does — a
   * season pass sitting unlabelled among games is how the search got noisy in
   * the first place.
   */
  dlc?: boolean;
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
  /**
   * What this seller charges in Eilat, AS PUBLISHED BY THE SELLER — never
   * derived. Eilat is a free-trade zone, so a purchase made in the city carries
   * no VAT, and a chain with a branch there prints the second price beside the
   * national one. Only set when the store actually publishes it: most don't
   * (they have no Eilat branch), and computing "price ÷ 1.18" for those would
   * invent a discount the buyer cannot get. Digital sellers never have one —
   * the relief follows the transaction's location, not the buyer's.
   */
  eilatPriceILS?: number;
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
  /**
   * True when this source has no standalone search and is only ever reached via
   * a companion hit emitted by another adapter (Steam, GG.deals and ITAD all
   * ride on CheapShark's Steam appID). Their `search` returns [] by design, so
   * the health canary must probe them through `getOffers` with
   * `healthProbeId` instead of reporting them as silently broken.
   */
  companion?: boolean;
  /**
   * Title for the health canary to search, when the platform's default probe
   * wouldn't be in this store's catalogue — Ubisoft doesn't sell Elden Ring, so
   * "no results" there would mean nothing.
   */
  healthProbe?: string;
  /** A known-good sourceGameId for canary probing of a `companion` adapter. */
  healthProbeId?: string;
  search(title: string, platforms: Platform[]): Promise<GameHit[]>;
  getOffers(sourceGameId: string, platform: Platform): Promise<Offer[]>;
}
