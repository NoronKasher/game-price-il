import type { Offer } from './adapters/types.ts';
import { lastCheckSnapshot, recordOffers, type WishlistRow } from './db.ts';
import { evaluateAlerts } from './notify.ts';

/**
 * Opportunistic price capture. Expanding a tracked game already scrapes its live
 * offers to fill the seller board — historically those prices were shown once and
 * thrown away, so the graph only gained a point when the (default 7-day)
 * auto-capture came round. That's exactly the "prices changed but the graph
 * stayed flat" complaint: the movement was on screen, never in the history.
 *
 * `captureFromView` records the offers the view ALREADY fetched — zero extra
 * requests to any store — but only when it's worth a point:
 *   - something actually changed since the last recorded check, or
 *   - the last check is older than a day (a daily anchor keeps the time axis
 *     honest even through quiet weeks).
 * Re-expanding a game five times an hour therefore adds nothing, while a real
 * price move lands on the graph (and through the sale alerts) the moment the
 * user looks at the game.
 */

/** Re-anchor the series this often even when nothing moved. */
const ANCHOR_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Is this game due for a scheduled re-check?
 *
 * Lives here so the server's scheduler and the extension's alarm ask the same
 * question. They had drifted into being two schedulers with one of them missing
 * entirely; the rule that decides how often a shop is asked about a game is not
 * something to keep two copies of.
 *
 * `lastChecked` is the UTC "YYYY-MM-DD HH:MM:SS" the database stores.
 */
export function isCaptureDue(
  lastChecked: string | null,
  captureDays: number | null,
  globalDays: number
): boolean {
  if (!lastChecked) return true; // never captured
  const lastMs = Date.parse(lastChecked.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(lastMs)) return true;
  return Date.now() - lastMs >= (captureDays ?? globalDays) * DAY_MS;
}

/** One offer's identity for change detection: source + bucket + price (2dp). */
const offerKey = (store: string, region: string | null, kind: string | null, priceILS: number) =>
  `${store}|${region ?? ''}|${kind ?? ''}|${priceILS.toFixed(2)}`;

/** Did the freshly scraped offers differ from the last recorded check at all? */
export function offersDiffer(
  prevRows: { store: string; region: string | null; kind: string | null; price_ils: number }[],
  offers: Offer[]
): boolean {
  const prev = new Set(prevRows.map((r) => offerKey(r.store, r.region, r.kind, r.price_ils)));
  const now = new Set(offers.map((o) => offerKey(o.store, o.region ?? null, o.kind, o.priceILS)));
  if (prev.size !== now.size) return true;
  for (const k of now) if (!prev.has(k)) return true;
  return false;
}

/**
 * Record already-fetched offers as a new history point when meaningful (see
 * module doc), then run the game's sale alerts. Returns whether a point was
 * recorded — the client uses that to refresh the bell immediately.
 */
export async function captureFromView(row: WishlistRow, offers: Offer[]): Promise<boolean> {
  if (offers.length === 0) return false; // an empty scrape is an outage, not a data point

  const prev = lastCheckSnapshot(row.id);
  if (prev) {
    const prevMs = Date.parse(prev.at.replace(' ', 'T') + 'Z'); // checked_at is UTC
    const fresh = Number.isFinite(prevMs) && Date.now() - prevMs < ANCHOR_MS;
    if (fresh && !offersDiffer(prev.rows, offers)) return false;
  }

  recordOffers(
    row.id,
    offers.map((o) => ({
      store: o.store,
      region: o.region ?? null,
      kind: o.kind,
      price: o.price,
      currency: o.currency,
      priceILS: o.priceILS,
    }))
  );
  try {
    await evaluateAlerts(row);
  } catch (err) {
    console.error(`alert check failed for #${row.id}:`, err);
  }
  return true;
}
