export type Platform = 'pc' | 'ps5' | 'ps4' | 'xbox-series' | 'xbox-one' | 'switch';

export interface GameHit {
  sourceId: string;
  sourceGameId: string;
  title: string;
  groupKey: string;
  edition: string | null;
  image?: string;
  platform: Platform;
}

export interface SourceRef {
  sourceId: string;
  sourceGameId: string;
}

export interface Offer {
  store: string;
  storeLogo?: string;
  kind: 'digital' | 'physical';
  location: 'israel' | 'international';
  price: number;
  currency: string;
  priceILS: number;
  retailPrice?: number;
  savings?: number;
  region?: string;
  regionName?: string;
  flag?: string;
  pinned?: boolean;
  url?: string;
}

/** Per-source outcome, so the UI can say "this store's data is missing / delayed" honestly. */
export interface SourceStatus {
  id: string;
  name: string;
  ok: boolean;
  reason?: 'error' | 'rate_limited';
  count: number;
}

export interface SearchResponse {
  query: { title: string; platforms: Platform[] };
  games: GameHit[];
  platformStatus?: Record<string, boolean>;
  sources?: SourceStatus[];
}

/**
 * WHICH of a tracked game's prices its sale alert watches — a game tracked for a
 * disc in an Israeli shop must not be judged on a US digital price.
 */
export type AlertScope = 'auto' | 'official' | 'physical' | 'cdkey' | 'any';
/** How a game relates to the global alert rule: inherit it, override it, or mute. */
export type AlertMode = 'global' | 'custom' | 'off';

/** The global sale-alert rule — applies to every tracked game that doesn't override it. */
export interface AlertRule {
  pct: number | null;
  price: number | null;
  ccy: string;
  anyDrop: boolean;
  scope: AlertScope;
}

/** Whether a tracked game is at a good price right now, judged on its own history. */
export interface PriceVerdict {
  kind: 'record' | 'cheapest-since' | 'above-low';
  currentILS: number;
  lowILS: number;
  lowAt: string;
  pctAboveLow: number;
  daysSinceCheaper?: number;
  checks: number;
  spanDays: number;
  /** Which price the verdict judged: the pinned region's store, or the cheapest of all. */
  scope: 'official' | 'any';
  /** How long the current price has been in place, and which way it moved to get here. */
  changedDaysAgo?: number;
  changeDirection?: 'down' | 'up';
}

export interface WishlistItem {
  id: number;
  platform: Platform;
  title: string;
  image: string | null;
  refs: SourceRef[];
  preferred_region: string | null;
  hide_desc: number;
  capture_days: number | null;
  alert_mode: string | null;
  alert_pct: number | null;
  alert_price: number | null;
  alert_price_ccy: string | null;
  alert_scope: string | null;
  added_at: string;
  current: { store: string; price_ils: number; checked_at: string; region?: string | null } | null;
  previous: { store: string; price_ils: number; checked_at: string; region?: string | null } | null;
  // Alongside the in-platform (region) price: cheapest disc + cheapest keyshop.
  physical: { store: string; price_ils: number } | null;
  cdkeys: { store: string; price_ils: number } | null;
  /** Null until there are at least two recorded checks to compare. */
  verdict: PriceVerdict | null;
}

export interface AppNotification {
  id: number;
  wishlist_id: number | null;
  title: string;
  message: string;
  price_ils: number | null;
  /** Why it fired: a plain drop, a discount threshold, or the price the user asked for. */
  kind: string | null;
  platform: Platform | null;
  scope: string | null;
  read: number;
  created_at: string;
}

export interface SettingsResponse {
  captureDaysGlobal: number;
  displayCurrency: 'ILS' | 'USD' | 'EUR';
  ratesFromILS: { ILS: number; USD: number; EUR: number };
  alerts: AlertRule;
}

export interface KeyStatus {
  configured: boolean;
  source: 'settings' | 'env' | 'file' | 'none';
}
export interface KeysResponse {
  ggdeals: KeyStatus;
  itad: KeyStatus;
}

export interface TickerDeal {
  title: string;
  salePrice: number; // in ₪ (converted from USD server-side)
  normalPrice: number; // in ₪
  savings: number; // percent
  rating?: number; // Steam positive-review %, when known
}

export interface HistoryPoint {
  store: string;
  region?: string | null;
  kind?: string | null;
  price?: number;
  currency?: string;
  price_ils: number;
  checked_at: string;
}

export interface TrackDetail {
  id: number;
  title: string;
  platform: Platform;
  image: string | null;
  preferredRegion: string | null;
  hideDesc: boolean;
  meta: { description: string; genres: string[]; image?: string } | null;
  offers: Offer[];
  /** True when this view's live offers were just recorded as a new history point. */
  captured?: boolean;
  history: HistoryPoint[];
}
