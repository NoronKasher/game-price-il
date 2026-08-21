import { isAllowedScrapeUrl } from './net.ts';

/**
 * Import sanitiser — the trust boundary for user-shared tracking files.
 *
 * An import file comes from another person, so it is untrusted input. Before any
 * of it reaches the database we coerce it to a known shape and drop anything
 * unsafe or malformed:
 *   - hard caps on counts and string lengths (a hostile file can't exhaust memory
 *     or bloat the DB),
 *   - platform / source-id allowlists (no junk rows, no unknown adapters),
 *   - product URLs restricted to hosts we actually scrape (defence in depth for
 *     the SSRF guard in net.ts — a planted internal URL never even gets stored),
 *   - numeric price fields validated as finite, non-negative numbers.
 * Whatever survives is safe to merge. This function is pure (no DB), so it can be
 * unit-tested against hostile payloads.
 */

const MAX_ITEMS = 5_000;
const MAX_REFS = 40;
const MAX_HISTORY = 20_000; // per game
const MAX_TOTAL_POINTS = 100_000; // across the whole file — bounds worst-case work
const MAX_STR = 400;

const PLATFORMS = new Set(['pc', 'ps5', 'ps4', 'xbox', 'switch']);
/**
 * Legacy platform ids from files exported before the two Xbox generations were
 * merged into one `xbox` platform. An old shared file still names them, so we
 * accept and remap them rather than silently dropping every Xbox game it holds.
 */
const PLATFORM_ALIASES: Record<string, string> = { 'xbox-series': 'xbox', 'xbox-one': 'xbox' };
/** Source ids we ship adapters for — keep in sync with the registry in index.ts. */
const SOURCE_IDS = new Set([
  'cheapshark',
  'steam-regional',
  'epic-games',
  'ubisoft-store',
  'ea-app',
  'ggdeals',
  'itad',
  'vgs',
  'player1',
  'arcadia',
  'gamestorm',
  'ivory',
  'bug',
  'psn-store',
  'xbox-store',
  'nintendo-eshop',
]);

export interface CleanRef {
  sourceId: string;
  sourceGameId: string;
}
export interface CleanPoint {
  store: string;
  region: string | null;
  kind: string | null;
  price: number;
  currency: string;
  price_ils: number;
  checked_at: string;
}
export interface CleanImportItem {
  title: string;
  platform: string;
  image: string | null;
  refs: CleanRef[];
  preferred_region: string | null;
  hide_desc: number;
  added_at: string | null;
  history: CleanPoint[];
}

/** A trimmed string clamped to `max`, or null if not a usable string. */
function str(v: unknown, max = MAX_STR): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

/** A finite, non-negative number (accepts numeric strings), or null. */
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Timestamps are ordered as TEXT everywhere (`MAX(checked_at)`,
 * `ORDER BY checked_at DESC`), so a point whose `checked_at` isn't the canonical
 * `YYYY-MM-DD HH:MM:SS` UTC form doesn't just look odd — it sorts wrong. A value
 * like "~evil" outranks every real timestamp and becomes the "latest" check,
 * poisoning the wishlist's current/previous prices, the disc & keyshop lines and
 * the sale-alert comparison; an unparseable one also renders as "Invalid Date"
 * and puts NaN coordinates in the SVG graph. Plain ISO-8601 ("…T09:00:00Z"),
 * which any hand-made or third-party file would use, mis-sorts against our
 * space-separated form for the same reason.
 *
 * So: accept anything Date can parse, but normalise it to the canonical form.
 * Anything else is dropped rather than stored.
 */
function timestamp(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 40) return null;
  // Treat our own space-separated form as UTC (it is), so it round-trips exactly.
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

function cleanRef(v: unknown): CleanRef | null {
  if (!v || typeof v !== 'object') return null;
  const sourceId = str((v as Record<string, unknown>).sourceId, 64);
  const sourceGameId = str((v as Record<string, unknown>).sourceGameId, 2048);
  if (!sourceId || !sourceGameId || !SOURCE_IDS.has(sourceId)) return null;
  // URL-typed ids (physical stores) must point at a host we actually scrape;
  // opaque ids (Steam appId, PSN code…) are kept as-is.
  if (/^https?:/i.test(sourceGameId) && !isAllowedScrapeUrl(sourceGameId)) return null;
  return { sourceId, sourceGameId };
}

function cleanPoint(v: unknown): CleanPoint | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const store = str(o.store, 120);
  const price = num(o.price);
  const price_ils = num(o.price_ils);
  const currency = str(o.currency, 8);
  const checked_at = timestamp(o.checked_at);
  if (!store || price === null || price_ils === null || !currency || !checked_at) return null;
  return { store, region: str(o.region, 40), kind: str(o.kind, 40), price, currency, price_ils, checked_at };
}

/** Coerce an arbitrary parsed JSON payload into safe, bounded import items. */
export function sanitizeImport(raw: unknown): CleanImportItem[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown })?.items)
      ? (raw as { items: unknown[] }).items
      : [];

  const out: CleanImportItem[] = [];
  let pointBudget = MAX_TOTAL_POINTS; // total points we'll even look at, across all items
  for (const entry of list.slice(0, MAX_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const title = str(o.title);
    const rawPlatform = str(o.platform, 20);
    const platform = rawPlatform ? (PLATFORM_ALIASES[rawPlatform] ?? rawPlatform) : null;
    if (!title || !platform || !PLATFORMS.has(platform)) continue;

    const image = str(o.image, 2048);
    const refs = Array.isArray(o.refs)
      ? o.refs.slice(0, MAX_REFS).map(cleanRef).filter((r): r is CleanRef => r !== null)
      : [];
    let history: CleanPoint[] = [];
    if (Array.isArray(o.history) && pointBudget > 0) {
      const slice = o.history.slice(0, Math.min(MAX_HISTORY, pointBudget));
      pointBudget -= slice.length; // charge the budget for work done, kept or not
      history = slice.map(cleanPoint).filter((p): p is CleanPoint => p !== null);
    }

    out.push({
      title,
      platform,
      image: image && /^https?:\/\//i.test(image) ? image : null,
      refs,
      preferred_region: str(o.preferred_region, 8),
      hide_desc: o.hide_desc ? 1 : 0,
      added_at: str(o.added_at, 40),
      history,
    });
  }
  return out;
}
