// Xbox Series and Xbox One are one cross-gen platform here: Microsoft sells a
// single Smart Delivery SKU and one disc plays on both, so a per-generation
// split only scattered the same game's offers across two boards. PS4/PS5 stay
// separate — those really are different discs at different prices.
/**
 * `other` is not a console — it is the absence of a claim.
 *
 * A price read off an Amazon page (or any future source we cannot query) rarely
 * says which platform the listing is for in a way worth parsing, and filing it
 * under `pc` would be inventing an answer. The tool's whole posture is to say
 * what it knows, so an unknown platform is labelled unknown and the user decides
 * what it is.
 *
 * Deliberately excluded from ALL_PLATFORMS: no adapter should ever be SEARCHED
 * for it. It exists only as a home for rows that arrive already priced.
 */
export type Platform = 'pc' | 'ps5' | 'ps4' | 'xbox' | 'switch' | 'other';

export interface GameHit {
  sourceId: string;
  sourceGameId: string;
  title: string;
  groupKey: string;
  edition: string | null;
  image?: string;
  platform: Platform;
  /** Add-on content, only present when the user opted into seeing add-ons. */
  dlc?: boolean;
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
  /** The seller's OWN published Eilat (VAT-free) price. Never derived — only
   *  set when the shop actually prints one, i.e. it has a branch there. */
  eilatPriceILS?: number;
  region?: string;
  regionName?: string;
  flag?: string;
  pinned?: boolean;
  url?: string;
}

/** Steam description + genres for a game (null server-side when it has no Steam ref). */
export interface GameMeta {
  description: string;
  genres: string[];
  image?: string;
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
  /** Grouping key of the typed title, for spotting an exact match. */
  queryKey?: string;
  games: GameHit[];
  platformStatus?: Record<string, boolean>;
  sources?: SourceStatus[];
  /**
   * Set when a Hebrew query was rewritten before the stores were asked. Shown
   * to the user, always: quietly searching for something other than what
   * somebody typed is how a tool loses their trust the first time it is wrong.
   */
  searchedAs?: { original: string; query: string; dropped: string[] };
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

/** One adapter's last probe result (server/src/health.ts). */
export interface AdapterHealth {
  id: string;
  name: string;
  state: 'ok' | 'empty' | 'error' | 'rate_limited' | 'disabled';
  count: number;
  ms: number;
  probe: string;
  detail?: string;
}

export interface HealthReport {
  checkedAt: string;
  adapters: AdapterHealth[];
}

export interface HealthResponse {
  report: HealthReport | null;
  due: boolean;
}

/** PlayStation persisted-query hash status (server/src/adapters/psnHash.ts). */
export interface PsnHashStatus {
  hash: string;
  source: 'env' | 'saved' | 'builtin';
  /** Name of the engine we could drive, when recovery is 'browser'. */
  browser: string | null;
  /**
   * HOW automatic recovery happens here, which is not the same question as
   * "did we find a browser".
   *
   * A single nullable engine name conflated three different situations and
   * answered all of them with "no Chromium-based browser was found on this
   * machine" — a sentence people read inside a Chromium-based browser, on a
   * machine with three of them, while the desktop build was quietly recovering
   * hashes perfectly well using its own.
   *
   *  'browser' — the server drives an installed browser (`browser` names it)
   *  'self'    — the desktop app uses the Chromium it already is
   *  'manual'  — not available in this shell; pasting one takes half a minute
   */
  recovery?: 'browser' | 'self' | 'manual';
}

/**
 * One step of a streamed search: a single store has answered.
 *
 * `games` is only what THAT source found — the caller accumulates. Re-sending
 * the running total on every step would grow quadratically across a stream of
 * sixteen for no benefit.
 */
export interface SearchProgress {
  /** How many sources will be asked. Known from the first line onward. */
  total: number;
  /** How many have answered, successfully or not. */
  done: number;
  status: SourceStatus;
  games: GameHit[];
}

/**
 * The lowest price a tracker has on record for a game.
 *
 * Attributed on purpose: this is somebody else's observation over years we were
 * not watching, and the shekel figure is today's rate applied to a price paid
 * long ago — a yardstick for the board, not a claim about what anyone here paid.
 */
export interface HistoryLow {
  price: number;
  currency: string;
  priceILS: number;
  window: 'all' | 'y1' | 'm3';
  source: string;
}

/**
 * A subscription whose catalogue already carries a game.
 *
 * Carries the market it was read for, because that is the entire caveat: a
 * title in the American catalogue is not necessarily in the Israeli one, and
 * saying otherwise would tell someone not to buy something they cannot play.
 */
export interface Inclusion {
  id: string;
  name: string;
  market: string;
}

/** What `api.offers` answers with. */
export interface OffersResponse {
  offers: Offer[];
  partial?: boolean;
  sources?: SourceStatus[];
  /** Widest window first; absent when no source keeps a record for this game. */
  lows?: HistoryLow[];
  /** Subscriptions that already carry this game. Never a price. */
  includedIn?: Inclusion[];
}

/** One step of a streamed price lookup: a single store has quoted. */
export interface OffersProgress {
  total: number;
  done: number;
  status: SourceStatus;
  offers: Offer[];
  lows?: HistoryLow[];
  includedIn?: Inclusion[];
}

/** One step of a Steam wishlist import. */
export interface SteamImportProgress {
  total: number;
  done?: number;
  title?: string;
  added?: number;
  skipped?: number;
}

/** What an import actually did, counted honestly. */
export interface SteamImportOutcome {
  added: number;
  /** Already tracked before this run — a re-import costs nothing. */
  skipped: number;
  /** DLC, demos and soundtracks on the wishlist, which are not tracked as games. */
  nonGames: number;
  /** Wishlisted apps Steam would say nothing about (delisted, region-locked). */
  unresolved: number;
  titles: string[];
}

export type SteamImportResult = ({ ok: true } & SteamImportOutcome) | { ok: false; reason: string };
