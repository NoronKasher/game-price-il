import {
  addToWishlist,
  recordOffers,
  listWishlist,
  removeFromWishlist,
  flush,
  ready,
  type WishlistRow,
} from './db.browser.ts';
import { toILS, canConvert } from '../../server/src/rates.ts';
import type { AmazonListing } from './amazon.ts';

/**
 * Store a listing the user read off an Amazon page.
 *
 * It joins the same tracked list as everything else, so its price sits in one
 * history beside the Steam and Israeli-shop rows and gets the same graph and the
 * same verdict. What it does NOT get is automatic re-checking: every other
 * source can be asked again on a schedule, and this one cannot, because asking
 * would mean fetching Amazon. It updates when the user next opens the page.
 *
 * That asymmetry is real and the UI says so rather than letting the row look
 * like the others and quietly go stale.
 */

/** Marks a row as one only the user's own visits can refresh. */
export const AMAZON_SOURCE = 'amazon-page';

/** Two store names, because a delivered price and an item price are not the same number. */
const DELIVERED_STORE = 'Amazon (כולל משלוח ומיסים)';
const PLAIN_STORE = 'Amazon';

/** Is this listing already tracked, and what do we hold for it? */
export function amazonStatus(asin: string): { tracked: boolean; row?: WishlistRow } {
  const row = listWishlist().find((r) => {
    try {
      return (JSON.parse(r.refs) as { sourceId: string; sourceGameId: string }[]).some(
        (ref) => ref.sourceId === AMAZON_SOURCE && ref.sourceGameId === asin
      );
    } catch {
      return false;
    }
  });
  return { tracked: Boolean(row), row };
}

/** The delivered cost, but only from what the page actually stated. */
function deliveredTotal(listing: AmazonListing): { total: number; stated: boolean } {
  const extras = (listing.importFees ?? 0) + (listing.shipping ?? 0);
  // "Stated" means Amazon printed at least one of the two, which is what
  // entitles the row to call itself a delivered price rather than an item price.
  const stated = listing.importFees !== undefined || listing.shipping !== undefined;
  return { total: listing.price + extras, stated };
}

/**
 * Record what the page says, whether or not the user pressed anything.
 *
 * If the listing is already tracked, the user asked for this price to be
 * followed — so opening the page IS the check. Making them press a button again
 * to save a number they are already looking at would lose readings for no
 * reason, and this source has no other way to get them.
 */
export async function recordAmazonVisit(
  listing: AmazonListing
): Promise<{ tracked: boolean; recorded: boolean; priceILS?: number }> {
  await ready();
  const { tracked, row } = amazonStatus(listing.asin);
  if (!tracked || !row) return { tracked: false, recorded: false };

  const { total, stated } = deliveredTotal(listing);
  if (!(await canConvert(listing.currency))) return { tracked: true, recorded: false };
  const priceILS = await toILS(total, listing.currency);
  recordOffers(row.id, [
    {
      store: stated ? DELIVERED_STORE : PLAIN_STORE,
      region: null,
      kind: 'physical',
      price: total,
      currency: listing.currency,
      priceILS,
    },
  ]);
  await flush();
  return { tracked: true, recorded: true, priceILS };
}

/** Stop following a listing the user added from a page. */
export async function untrackAmazonListing(asin: string): Promise<boolean> {
  await ready();
  const { row } = amazonStatus(asin);
  if (!row) return false;
  removeFromWishlist(row.id);
  await flush();
  return true;
}

export async function trackAmazonListing(listing: AmazonListing): Promise<void> {
  if (!listing?.title || !(listing.price > 0) || !listing.asin) {
    throw new Error('nothing readable on that page');
  }
  await ready();

  if (!(await canConvert(listing.currency))) {
    throw new Error(`no exchange rate for ${listing.currency}`);
  }

  const { total, stated } = deliveredTotal(listing);
  const priceILS = await toILS(total, listing.currency);

  // Matched on the ASIN, not the title. Amazon rewrites product names, and a
  // title match let the same listing be added again every time the page was
  // reloaded — the user ended up with duplicates of one item.
  const existing = amazonStatus(listing.asin).row;
  const row =
    existing ??
    addToWishlist({
      title: listing.title,
      // 'other', not 'pc'. An Amazon listing rarely says which platform it is
      // for in a way worth parsing, and filing it under a console we guessed
      // would be the tool inventing an answer.
      platform: 'other',
      refs: [{ sourceId: AMAZON_SOURCE, sourceGameId: listing.asin }],
    });

  recordOffers(row.id, [
    {
      // The store name carries whether this is the delivered cost, because the
      // two are not comparable and the row shows a single line.
      store: stated ? DELIVERED_STORE : PLAIN_STORE,
      region: null,
      kind: 'physical',
      price: total,
      currency: listing.currency,
      priceILS,
    },
  ]);
  await flush();
}
