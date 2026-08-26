import { addToWishlist, recordOffers, findWishlist, flush, ready } from './db.browser.ts';
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

export async function trackAmazonListing(listing: AmazonListing): Promise<void> {
  if (!listing?.title || !(listing.price > 0) || !listing.asin) {
    throw new Error('nothing readable on that page');
  }
  await ready();

  if (!(await canConvert(listing.currency))) {
    throw new Error(`no exchange rate for ${listing.currency}`);
  }
  // The delivered cost, but ONLY from figures Amazon printed. A page that named
  // neither is recorded at the item price, which is the honest number we have —
  // not an item price dressed up as a total.
  const extras = (listing.importFees ?? 0) + (listing.shipping ?? 0);
  const total = listing.price + extras;
  const priceILS = await toILS(total, listing.currency);

  // 'other', not 'pc'. An Amazon listing rarely says which platform it is for in
  // a way worth parsing, and filing it under a console we guessed would be the
  // tool inventing an answer — the one thing it is built not to do.
  const row =
    findWishlist(listing.title, 'other') ??
    addToWishlist({
      title: listing.title,
      platform: 'other',
      refs: [{ sourceId: AMAZON_SOURCE, sourceGameId: listing.asin }],
    });

  recordOffers(row.id, [
    {
      // The store name carries whether the number is the delivered cost, because
      // the two are not comparable and the row shows only one line.
      store: extras > 0 ? 'Amazon (כולל משלוח ומיסים)' : 'Amazon',
      region: null,
      kind: 'physical',
      price: total,
      currency: listing.currency,
      priceILS,
    },
  ]);
  await flush();
}
