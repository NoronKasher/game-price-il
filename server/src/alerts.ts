/**
 * Sale-alert decisions — pure (no DB, no network, no currency lookup; the caller
 * resolves the threshold to ILS first) so every rule here is unit-testable.
 *
 * Two layers:
 *   1. `effectiveAlertRule` — WHICH rule applies to a tracked game. Alerts are ON
 *      for every tracked game by default via one global rule; a game may override
 *      it with its own thresholds ('custom') or silence itself ('off').
 *   2. `alertFires` — whether that rule fires on this check. A threshold rule only
 *      fires when it NEWLY becomes true (the watched price crosses it now, having
 *      not met it on the previous check), so a game that simply stays on sale
 *      doesn't notify on every capture.
 */

/**
 * WHICH price of a tracked game the alert watches. A game can be tracked for very
 * different things — one for the PSN US digital price, one for a CD-key seller,
 * one for a disc in an Israeli shop — so the alert must follow the same price the
 * user actually cares about.
 *   - 'auto'     the headline price shown in the tracking list (the preferred
 *                region's official price when one is pinned, else the cheapest)
 *   - 'official' the in-platform store price (PSN/Xbox/Nintendo/Steam), pinned to
 *                the game's preferred region when it has one
 *   - 'physical' the cheapest disc
 *   - 'cdkey'    the cheapest key seller / external digital shop
 *   - 'any'      the cheapest offer of any kind
 */
export type AlertScope = 'auto' | 'official' | 'physical' | 'cdkey' | 'any';
export const ALERT_SCOPES: readonly AlertScope[] = ['auto', 'official', 'physical', 'cdkey', 'any'];
export function isAlertScope(v: unknown): v is AlertScope {
  return typeof v === 'string' && (ALERT_SCOPES as readonly string[]).includes(v);
}

/** How a tracked game relates to the global alert rule. */
export type AlertMode = 'global' | 'custom' | 'off';
export function isAlertMode(v: unknown): v is AlertMode {
  return v === 'global' || v === 'custom' || v === 'off';
}

/** The global rule, applied to every tracked game that doesn't override it. */
export interface AlertRule {
  /** Notify at ≥ this % off the normal (baseline) price; null = no percent rule. */
  pct: number | null;
  /** Notify at/below this price; null = no price rule. */
  price: number | null;
  /** Currency of `price`. */
  ccy: string;
  /** Notify on ANY drop below the previous check, however small. */
  anyDrop: boolean;
  /** Which of the game's prices to watch. */
  scope: AlertScope;
}

/** The alert-related columns of a tracked game. */
export interface GameAlertSettings {
  alert_mode: string | null;
  alert_pct: number | null;
  alert_price: number | null;
  alert_price_ccy: string | null;
  alert_scope: string | null;
}

/**
 * Resolve the rule actually in force for one tracked game, or null when it is
 * silenced. `alert_scope` is honoured even in 'global' mode: which price to watch
 * is a property of how the user tracks THAT game, while the thresholds are the
 * shared default.
 *
 * A 'custom' game answers only to its own thresholds — someone who sets "tell me
 * at ₪120" does not also want the global "any drop" chatter.
 */
export function effectiveAlertRule(
  game: GameAlertSettings,
  defaults: AlertRule
): AlertRule | null {
  const mode: AlertMode = isAlertMode(game.alert_mode) ? game.alert_mode : 'global';
  if (mode === 'off') return null;
  const scope = isAlertScope(game.alert_scope) ? game.alert_scope : defaults.scope;

  const rule: AlertRule =
    mode === 'custom'
      ? {
          pct: game.alert_pct,
          price: game.alert_price,
          ccy: game.alert_price_ccy || 'ILS',
          anyDrop: false,
          scope,
        }
      : { ...defaults, scope };

  // Nothing to watch for → don't even query the history.
  if (rule.pct == null && rule.price == null && !rule.anyDrop) return null;
  return rule;
}

export interface AlertInputs {
  /** Notify at ≥ this % off the normal (baseline) price; null = no percent rule. */
  alertPct: number | null;
  /** Notify at/below this price, already converted to ILS; null = no price rule. */
  thresholdILS: number | null;
  /** Notify on any decrease from the previous check. */
  notifyAnyDrop?: boolean;
  /** Current watched price (ILS). */
  current: number;
  /** Previous check's watched price (ILS), or null if this is the first check. */
  prev: number | null;
  /** The "normal" reference price (ILS) — the highest the watched price has been. */
  baseline: number;
}

export interface AlertResult {
  /** Crossed the percent-off threshold on this check. */
  pct: boolean;
  /** Crossed the absolute-price threshold on this check. */
  price: boolean;
  /** Simply cheaper than the previous check. */
  drop: boolean;
}

export function alertFires(o: AlertInputs): AlertResult {
  let pct = false;
  if (o.alertPct != null && o.baseline > 0) {
    const disc = (p: number) => ((o.baseline - p) / o.baseline) * 100;
    pct = disc(o.current) >= o.alertPct && !(o.prev != null && disc(o.prev) >= o.alertPct);
  }

  let price = false;
  if (o.thresholdILS != null) {
    price = o.current <= o.thresholdILS && !(o.prev != null && o.prev <= o.thresholdILS);
  }

  // "Cheaper than last time" needs a previous check to compare against — the very
  // first price we ever record for a game is news, not a drop.
  const drop = !!o.notifyAnyDrop && o.prev != null && o.current < o.prev;

  return { pct, price, drop };
}

/**
 * The single reason to report, strongest first: hitting the price the user asked
 * for beats a percentage, which beats a bare drop. One check produces at most one
 * notification, so a deep sale doesn't stack three near-identical lines in the bell.
 */
export function primaryReason(f: AlertResult): 'price' | 'pct' | 'drop' | null {
  if (f.price) return 'price';
  if (f.pct) return 'pct';
  if (f.drop) return 'drop';
  return null;
}

/** Percent off the baseline, rounded — for the notification message. */
export function discountPct(current: number, baseline: number): number {
  return baseline > 0 ? Math.round(((baseline - current) / baseline) * 100) : 0;
}
