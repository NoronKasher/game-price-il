import { CHEAPSHARK_HEADERS } from './adapters/cheapshark.ts';
import { toILS } from './rates.ts';

/**
 * Today's deals worth caring about.
 *
 * Lifted out of the Express route so the extension can answer the same call —
 * it was the last piece of the ticker that only existed on the server, which is
 * why the extension's ticker was an empty strip of nothing.
 *
 * This is the one "scraping" call in the whole tool that scrapes nothing:
 * CheapShark publishes a JSON API and opts into cross-origin use, so it costs a
 * single request to one endpoint that exists to be called. No store is touched.
 *
 * Sorting purely by discount percentage surfaced obscure $1 shovelware nobody
 * recognises, so this sorts by CheapShark's own "Deal Rating" and demands a real
 * Metacritic (≥75) AND a strong Steam rating (≥80). Prices convert USD → ₪ so
 * they mean something to an Israeli reader.
 */

export interface TickerDeal {
  title: string;
  salePrice: number;
  normalPrice: number;
  savings: number;
  rating?: number;
}

const FEED =
  'https://www.cheapshark.com/api/1.0/deals?sortBy=Deal%20Rating&metacritic=75&steamRating=80&onSale=1&pageSize=40';

/**
 * The strip shows fifteen. The deals PAGE wants more than a strip can carry, so
 * the cap is a parameter and this is only the default.
 */
const MAX_DEALS = 15;
const HARD_MAX = 40;

interface RawDeal {
  title: string;
  salePrice: string;
  normalPrice: string;
  savings: string;
  steamRatingPercent?: string;
}

/** Never throws: an empty ticker is a quiet strip, a thrown one is a broken page. */
export async function tickerDeals(limit = MAX_DEALS): Promise<TickerDeal[]> {
  try {
    const res = await fetch(FEED, { headers: CHEAPSHARK_HEADERS });
    if (!res.ok) return [];
    const raw = (await res.json()) as RawDeal[];
    const seen = new Set<string>();
    const deals: TickerDeal[] = [];
    for (const d of raw) {
      if (seen.has(d.title)) continue; // the same game repeats once per store
      seen.add(d.title);
      const saleUsd = Number(d.salePrice);
      const normalUsd = Number(d.normalPrice);
      // Both prices must be real numbers: an unparseable normalPrice would reach
      // the client as JSON `null` (Math.round(NaN)) and render a blank "original
      // price" next to a valid sale price.
      if (!Number.isFinite(saleUsd) || saleUsd <= 0) continue;
      if (!Number.isFinite(normalUsd) || normalUsd <= 0) continue;
      deals.push({
        title: d.title,
        // Keep agorot. Rounding to whole shekels here distorted the price the
        // user actually sees: $0.99 → ₪3 → back to $0.98 once the client
        // formats it in dollars. The client rounds for display; this keeps the
        // real converted amount.
        salePrice: await toILS(saleUsd, 'USD'),
        normalPrice: await toILS(normalUsd, 'USD'),
        savings: Math.round(Number(d.savings)),
        rating: d.steamRatingPercent ? Number(d.steamRatingPercent) : undefined,
      });
      if (deals.length >= Math.min(Math.max(1, limit), HARD_MAX)) break;
    }
    return deals;
  } catch {
    return [];
  }
}
