/**
 * "Is this a good price right now?" — the one question a tracking list exists to
 * answer, worked out from the game's own history rather than from a discount
 * percentage the shop chose to advertise.
 *
 * Pure and self-contained: hand it the price series the list already computes
 * (newest first) and it returns the verdict, so the rule is unit-testable and
 * the same everywhere it's shown.
 */

export type VerdictKind =
  /** At (or within noise of) the lowest price ever recorded for this game. */
  | 'record'
  /** Not a record, but nothing cheaper has been seen for a meaningful stretch. */
  | 'cheapest-since'
  /** Simply above its known low — no news. */
  | 'above-low';

export interface PriceVerdict {
  kind: VerdictKind;
  currentILS: number;
  lowILS: number;
  /** When the low was recorded (UTC, 'YYYY-MM-DD HH:MM:SS'). */
  lowAt: string;
  /** How far above the low today's price sits, rounded. */
  pctAboveLow: number;
  /** 'cheapest-since' only: days since anything cheaper was last seen. */
  daysSinceCheaper?: number;
  /** How many checks the verdict is based on — "lowest ever" off two checks is
   *  true but nearly meaningless, so the UI can show what the claim rests on. */
  checks: number;
  /** Days between the oldest and newest check in the series. */
  spanDays: number;
  /**
   * How long ago the price last moved, and which way.
   *
   * No source we read publishes a sale END date — CheapShark returns prices
   * only, GG.deals a snapshot, and the shops' pages carry no structured expiry —
   * so we can't say "sale ends Tuesday" without inventing it. What our own
   * history does know is when the drop happened, which is the honest half of
   * the same question: a cut made yesterday is news, one made in March isn't.
   */
  changedDaysAgo?: number;
  changeDirection?: 'down' | 'up';
}

/**
 * Prices within this percent of each other count as the same price. Foreign
 * prices are stored in ILS converted at capture time, so a stale rate makes a
 * record look like a near-miss (and vice versa); this is the same noise floor
 * the sale alerts use.
 */
const SAME_PCT = 1;

/** A stretch shorter than this isn't worth calling out — prices move weekly. */
const NOTABLE_DAYS = 14;

const parseUtc = (at: string): number => Date.parse(at.replace(' ', 'T') + 'Z');

function daysBetween(earlier: string, later: string): number {
  const a = parseUtc(earlier);
  const b = parseUtc(later);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** `series` is cheapest-per-check, NEWEST FIRST — exactly what bestPerCheck* returns. */
export function priceVerdict(
  series: { price_ils: number; checked_at: string }[]
): PriceVerdict | null {
  // One lone check can't say whether a price is good; claiming "lowest ever"
  // off a single data point would be true and worthless.
  if (series.length < 2) return null;

  const current = series[0]!;
  let low = current;
  for (const p of series) if (p.price_ils < low.price_ils) low = p;

  const pctAboveLow = low.price_ils > 0 ? ((current.price_ils - low.price_ils) / low.price_ils) * 100 : 0;
  const oldest = series[series.length - 1]!;

  // Walk back to the first check that held a meaningfully different price; the
  // change itself happened at the check just after it.
  const differsAt = series.findIndex(
    (p, i) => i > 0 && Math.abs(p.price_ils - current.price_ils) / (current.price_ils || 1) * 100 > SAME_PCT
  );
  const change =
    differsAt > 0
      ? {
          changedDaysAgo: daysBetween(series[differsAt - 1]!.checked_at, current.checked_at),
          changeDirection: (current.price_ils < series[differsAt]!.price_ils ? 'down' : 'up') as
            | 'down'
            | 'up',
        }
      : {};

  const base = {
    currentILS: current.price_ils,
    lowILS: low.price_ils,
    lowAt: low.checked_at,
    pctAboveLow: Math.round(pctAboveLow),
    checks: series.length,
    spanDays: daysBetween(oldest.checked_at, current.checked_at),
    ...change,
  };

  if (pctAboveLow <= SAME_PCT) return { ...base, kind: 'record' };

  // The most recent check that was genuinely cheaper than today (series is
  // newest-first, so the first match is the latest such check).
  const cheaper = series.find(
    (p, i) => i > 0 && p.price_ils < current.price_ils * (1 - SAME_PCT / 100)
  );
  if (cheaper) {
    const days = daysBetween(cheaper.checked_at, current.checked_at);
    if (days >= NOTABLE_DAYS) return { ...base, kind: 'cheapest-since', daysSinceCheaper: days };
  }

  return { ...base, kind: 'above-low' };
}
