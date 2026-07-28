import {
  addNotification,
  bestPerCheckForScope,
  getAlertDefaults,
  getDisplayCurrency,
  type WishlistRow,
} from './db.ts';
import { ilsTo, toILS } from './rates.ts';
import { alertFires, discountPct, effectiveAlertRule, primaryReason } from './alerts.ts';

/**
 * Turning a freshly recorded price into a notification. Kept out of index.ts so
 * the decision — did this check deserve to interrupt the user, and what should it
 * say — can be tested against a real database without starting a web server.
 */

/** Format an ILS amount in the current display currency, for notification text. */
async function fmtDisplay(ils: number): Promise<string> {
  const ccy = getDisplayCurrency();
  const sym = ccy === 'USD' ? '$' : ccy === 'EUR' ? '€' : '₪';
  const v = ccy === 'ILS' ? ils : ils * (await ilsTo(ccy));
  return sym + v.toFixed(2);
}

/**
 * Where a watched price came from, in the user's words — so a notification says
 * WHICH of the game's prices moved (its disc, its key-seller price, or its store
 * price in the region being tracked), not just a bare number.
 */
function sourceLabel(p: { store: string; region: string | null; kind: string | null }): string {
  if (p.kind === 'physical') return `💿 דיסק · ${p.store}`;
  if (p.region) return `☁️ חנות רשמית (${p.region}) · ${p.store}`;
  return `🔑 מוכר מפתחות · ${p.store}`;
}

/**
 * After a fresh price point is recorded, decide whether to notify. Every tracked
 * game is watched by the global rule unless it overrides it, and each game is
 * judged on the price IT is tracked for (`alert_scope` — official store in its
 * preferred region, disc, key seller…). A threshold only fires when it NEWLY
 * becomes true, so a game that stays on sale doesn't notify on every capture.
 *
 * At most one notification per check: the strongest reason wins, so a deep sale
 * doesn't stack three near-identical lines in the bell. Returns what it queued
 * (or null), which is what makes it testable.
 */
export async function evaluateAlerts(
  row: WishlistRow
): Promise<{ reason: string; message: string } | null> {
  const rule = effectiveAlertRule(row, getAlertDefaults());
  if (!rule) return null; // silenced, or no rule set at all

  const bests = bestPerCheckForScope(row.id, rule.scope, row.preferred_region);
  if (bests.length === 0) return null; // nothing of that kind has ever been recorded
  const point = bests[0]!;
  const current = point.price_ils;
  const prev = bests.length > 1 ? bests[1]!.price_ils : null;
  const baseline = Math.max(...bests.map((b) => b.price_ils)); // "normal" = highest it's been

  // Resolve the price threshold to ILS (unknown currency → treat the number as ILS).
  let thresholdILS: number | null = rule.price;
  if (rule.price != null && rule.ccy !== 'ILS') {
    try {
      thresholdILS = await toILS(rule.price, rule.ccy);
    } catch {
      /* keep the raw number as ILS */
    }
  }

  const fires = alertFires({
    alertPct: rule.pct,
    thresholdILS,
    notifyAnyDrop: rule.anyDrop,
    current,
    prev,
    baseline,
  });
  const reason = primaryReason(fires);
  if (!reason) return null;

  const now = await fmtDisplay(current);
  const where = sourceLabel(point);
  const message =
    reason === 'price'
      ? `${now} — מתחת לסף שהגדרתם (${await fmtDisplay(thresholdILS!)}) · ${where}`
      : reason === 'pct'
        ? `${now} — ${discountPct(current, baseline)}% הנחה מהמחיר הרגיל (${await fmtDisplay(baseline)}) · ${where}`
        : `ירד מ־${await fmtDisplay(prev!)} ל־${now} · ${where}`;

  addNotification({
    wishlistId: row.id,
    title: row.title,
    message,
    priceILS: current,
    kind: reason,
    platform: row.platform,
    scope: rule.scope,
  });
  return { reason, message };
}
