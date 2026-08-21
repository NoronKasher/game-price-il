import type { Offer } from './types';

/**
 * Eilat pricing — a VAT-free ESTIMATE, never a scraped price.
 *
 * Eilat sits in a free-trade zone, so a purchase made there carries 0% VAT
 * instead of the national rate, which is why a console or a game is routinely
 * cheaper bought in the city. That gap is real and worth showing.
 *
 * What is NOT available is an actual Eilat price feed: every Israeli retailer we
 * can reach publishes one national, VAT-inclusive price online, and the Eilat
 * rate applies at the branch. (Ivory's site mentions Eilat 71 times — all of it
 * a branch dropdown, not a price.) So this derives the figure by removing VAT,
 * and every derived number is badged as an estimate. Presenting a computed
 * number as if a shop had quoted it is exactly the kind of confident-but-wrong
 * price this project refuses to print.
 *
 * Only PHYSICAL goods from Israeli shops are converted, and that restriction is
 * the whole point of the rule:
 *  - A Turkish Steam price has no Israeli VAT in it to remove; "discounting" it
 *    would invent an 18% saving that does not exist.
 *  - A Steam ISRAEL price does contain Israeli VAT, but the Eilat exemption does
 *    not reach it. The free-trade-zone relief applies to a transaction made in
 *    the city; a digital storefront charges VAT on the account's country no
 *    matter where the buyer is standing. Flying to Eilat does not make a Steam
 *    key 18% cheaper, so showing that it would is precisely the confident-but-
 *    wrong number this file exists to avoid.
 */

/**
 * Israel's standard VAT, 18% since January 2025 (verified August 2026).
 * A proposal to levy 9% in Eilat has been floated but is not law; if it passes,
 * this is the one place that needs changing.
 */
export const VAT_RATE = 0.18;

/** A physical item, sold by an Israeli shop — the only case Eilat relief covers. */
export function isIsraeliSeller(o: Offer): boolean {
  return o.kind === 'physical' && o.location === 'israel';
}

/** The same price without VAT, rounded to agorot. */
export function exVat(priceILS: number): number {
  return Math.round((priceILS / (1 + VAT_RATE)) * 100) / 100;
}

/**
 * What an offer would cost bought in Eilat, or null when the question doesn't
 * apply (a foreign seller has no Israeli VAT to remove).
 */
export function eilatPrice(o: Offer): number | null {
  return isIsraeliSeller(o) ? exVat(o.priceILS) : null;
}

/** Does this board have anything the Eilat view would actually change? */
export function boardHasIsraeliSellers(offers: Offer[]): boolean {
  return offers.some(isIsraeliSeller);
}
