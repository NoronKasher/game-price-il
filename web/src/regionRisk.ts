import { isDirectPurchase, regionLabel, storeFamily } from './source';
import type { Offer } from './types';

/**
 * What it actually takes to buy a given row — the gap between "cheapest" and
 * "cheapest I can really use".
 *
 * The board happily shows a Turkish price 80% below the Israeli one, but that
 * number is only reachable if the buyer can pay as a Turkish customer, and a key
 * bought from a reseller can be locked to a region regardless of price. Showing
 * the number without the condition is the dishonest part, so every row carries
 * its condition.
 *
 * This NEVER blocks anything. It labels, and the "only what I can buy" filter is
 * opt-in and reversible — the user stays free to buy any row they like; they
 * just get told what to expect first.
 */

export type RiskLevel = 'ok' | 'account' | 'keylock';

export interface RowRisk {
  level: RiskLevel;
  /** Terse chip shown on the row, or null when there's nothing to flag. */
  badge: string | null;
  /** Fuller sentence for the row's tooltip. */
  detail: string | null;
}

const OK: RowRisk = { level: 'ok', badge: null, detail: null };

/**
 * `preferred` is the user's own market (Settings → default country), so a row in
 * that market is simply "buyable" and carries no badge.
 */
export function offerRisk(o: Offer, preferred: string): RowRisk {
  // A disc bought from an Israeli shop is just a purchase.
  if (o.kind === 'physical') return OK;

  const family = storeFamily(o.store).key;
  const direct = isDirectPurchase(family);

  if (o.region && o.region !== preferred) {
    const where = regionLabel(o.region) ?? o.region;
    return direct
      ? {
          level: 'account',
          badge: 'חשבון זר',
          detail: `המחיר הזה הוא של חנות ${where}. כדי לשלם אותו בפועל צריך בדרך כלל חשבון ואמצעי תשלום ששייכים ל${where} — שינוי אזור בחשבון קיים לא תמיד אפשרי ולעיתים נעול לתקופה.`,
        }
      : {
          level: 'keylock',
          badge: 'מפתח אזורי',
          detail: `מפתח שנמכר עבור אזור ${where}. ייתכן שלא ייפתח בחשבון ישראלי, ולרוב אין החזר על מפתח שכבר נוסה.`,
        };
  }

  // No region on the row: either the platform itself (fine) or a key seller.
  if (!direct) {
    return {
      level: 'keylock',
      // The region column already reads "מפתח" for these rows, so the badge has
      // to say something the row doesn't: what the buyer should go and check.
      badge: 'בדקו אזור',
      detail:
        'הרכישה כאן היא מפתח לחנות אחרת, לא קנייה ישירה. מפתחות עשויים להיות מוגבלים לאזור מסוים, ולרוב אין החזר אחרי שנעשה בהם שימוש — כדאי לוודא באתר המוכר לאיזה אזור המפתח מיועד לפני התשלום.',
    };
  }
  return OK;
}

/** Does this board contain anything the user should be warned about at all? */
export function boardHasRisk(offers: Offer[], preferred: string): boolean {
  return offers.some((o) => offerRisk(o, preferred).level !== 'ok');
}

/** Persisted "I've read this, stop showing it" for the board-level notice. */
const DISMISS_KEY = 'gp_hide_region_notice';

export function loadRegionNoticeHidden(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveRegionNoticeHidden(v: boolean): void {
  try {
    localStorage.setItem(DISMISS_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}
