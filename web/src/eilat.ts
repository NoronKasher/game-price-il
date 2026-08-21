import type { Offer } from './types';

/**
 * Eilat pricing — read from the shops, never calculated.
 *
 * Eilat sits in a free-trade zone, so a purchase made in the city carries no
 * VAT, and games really are cheaper bought there. A chain with an Eilat branch
 * prints that second price beside the national one; Ivory, for instance, shows
 * "מחיר באילת: 194 ₪" under a ₪229 game.
 *
 * An earlier version of this file DERIVED the figure by removing VAT from every
 * Israeli price. That was wrong in both directions and is not coming back:
 *  - Most of our shops have no Eilat branch at all, so there is no Eilat price
 *    to show — subtracting VAT invented a discount the buyer could never get.
 *  - Where a shop does publish one, the real number is the one that matters;
 *    rounding and per-branch pricing are the shop's business, not arithmetic we
 *    should be guessing at.
 *
 * So a row has an Eilat price only when its seller published one. Everything
 * else simply has none, and the UI says so rather than filling the gap.
 */

/** The seller's own published Eilat price, or null when it doesn't publish one. */
export function eilatPrice(o: Offer): number | null {
  return typeof o.eilatPriceILS === 'number' && o.eilatPriceILS > 0 ? o.eilatPriceILS : null;
}

/** How much the Eilat branch saves on this row, as a percentage. */
export function eilatSaving(o: Offer): number | null {
  const e = eilatPrice(o);
  if (e == null || !(o.priceILS > 0) || e >= o.priceILS) return null;
  return Math.round((1 - e / o.priceILS) * 100);
}

/** Does this board have any real Eilat price to show? */
export function boardHasEilatPrices(offers: Offer[]): boolean {
  return offers.some((o) => eilatPrice(o) != null);
}
