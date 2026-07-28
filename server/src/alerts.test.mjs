import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertFires, discountPct, effectiveAlertRule, primaryReason } from './alerts.ts';

/** The shipped global rule: any real drop is reported, 20% off is a "worth a look". */
const GLOBAL = { pct: 20, price: null, ccy: 'ILS', anyDrop: true, scope: 'auto' };
/** A tracked game with no alert settings of its own. */
const plainGame = {
  alert_mode: null,
  alert_pct: null,
  alert_price: null,
  alert_price_ccy: null,
  alert_scope: null,
};

test('percent alert fires only when it newly crosses the discount threshold', () => {
  // baseline 200, price drops 200 → 120 (40% off), rule = 30% → fires.
  assert.equal(alertFires({ alertPct: 30, thresholdILS: null, current: 120, prev: 200, baseline: 200 }).pct, true);
  // already 35% off last check → not a new crossing → no fire.
  assert.equal(alertFires({ alertPct: 30, thresholdILS: null, current: 120, prev: 130, baseline: 200 }).pct, false);
  // not deep enough (only 20% off) → no fire.
  assert.equal(alertFires({ alertPct: 30, thresholdILS: null, current: 160, prev: 200, baseline: 200 }).pct, false);
  // first-ever check (no prev) at 40% off → fires.
  assert.equal(alertFires({ alertPct: 30, thresholdILS: null, current: 120, prev: null, baseline: 200 }).pct, true);
});

test('price alert fires only when it newly drops to/below the threshold', () => {
  // was 130 (above), now 116 (at/below 120) → fires.
  assert.equal(alertFires({ alertPct: null, thresholdILS: 120, current: 116, prev: 130, baseline: 200 }).price, true);
  // already below last check → no new crossing → no fire.
  assert.equal(alertFires({ alertPct: null, thresholdILS: 120, current: 116, prev: 110, baseline: 200 }).price, false);
  // still above the threshold → no fire.
  assert.equal(alertFires({ alertPct: null, thresholdILS: 120, current: 125, prev: 130, baseline: 200 }).price, false);
  // first-ever check already below → fires.
  assert.equal(alertFires({ alertPct: null, thresholdILS: 120, current: 116, prev: null, baseline: 200 }).price, true);
});

test('no rule set → nothing fires', () => {
  const r = alertFires({ alertPct: null, thresholdILS: null, current: 50, prev: 200, baseline: 200 });
  assert.deepEqual(r, { pct: false, price: false, drop: false });
});

test('both rules can fire on the same check', () => {
  const r = alertFires({ alertPct: 30, thresholdILS: 130, current: 120, prev: 200, baseline: 200 });
  assert.equal(r.pct, true);
  assert.equal(r.price, true);
});

test('any tracked game is watched by the global rule with no setup', () => {
  const rule = effectiveAlertRule(plainGame, GLOBAL);
  assert.deepEqual(rule, GLOBAL);
});

test('a game can override the global rule, or silence itself', () => {
  // 'off' → never notified, even though the global rule is active.
  assert.equal(effectiveAlertRule({ ...plainGame, alert_mode: 'off' }, GLOBAL), null);

  // 'custom' → only this game's thresholds; the global "any drop" doesn't leak in,
  // so asking for "tell me at ₪120" doesn't also report every ₪1 dip.
  const custom = effectiveAlertRule(
    { ...plainGame, alert_mode: 'custom', alert_price: 120, alert_price_ccy: 'USD' },
    GLOBAL
  );
  assert.deepEqual(custom, { pct: null, price: 120, ccy: 'USD', anyDrop: false, scope: 'auto' });

  // 'custom' with nothing filled in is the same as silence — nothing to check.
  assert.equal(effectiveAlertRule({ ...plainGame, alert_mode: 'custom' }, GLOBAL), null);
});

test('the watched price follows the game, even under the global rule', () => {
  // A game tracked for its disc price keeps that scope while inheriting the
  // global thresholds — scope is how you track the game, not what counts as a deal.
  const rule = effectiveAlertRule({ ...plainGame, alert_scope: 'physical' }, GLOBAL);
  assert.deepEqual(rule, { ...GLOBAL, scope: 'physical' });
  // An unknown/corrupt scope falls back to the global one rather than dropping alerts.
  assert.equal(effectiveAlertRule({ ...plainGame, alert_scope: 'bogus' }, GLOBAL).scope, 'auto');
});

test('a global rule with nothing enabled watches nothing', () => {
  const off = { pct: null, price: null, ccy: 'ILS', anyDrop: false, scope: 'auto' };
  assert.equal(effectiveAlertRule(plainGame, off), null);
});

test('"any drop" fires on a plain decrease, but never on the first-ever price', () => {
  const base = { alertPct: null, thresholdILS: null, notifyAnyDrop: true, baseline: 200 };
  assert.equal(alertFires({ ...base, current: 199, prev: 200 }).drop, true); // ₪1 counts
  assert.equal(alertFires({ ...base, current: 200, prev: 200 }).drop, false); // unchanged
  assert.equal(alertFires({ ...base, current: 210, prev: 200 }).drop, false); // went up
  assert.equal(alertFires({ ...base, current: 120, prev: null }).drop, false); // first check
  // Off by default in custom rules — no drop reported when not asked for.
  assert.equal(alertFires({ ...base, notifyAnyDrop: false, current: 199, prev: 200 }).drop, false);
});

test('one check reports one reason, strongest first', () => {
  // A deep sale can satisfy all three rules; the bell should get a single line.
  const all = alertFires({
    alertPct: 30,
    thresholdILS: 130,
    notifyAnyDrop: true,
    current: 120,
    prev: 200,
    baseline: 200,
  });
  assert.deepEqual(all, { pct: true, price: true, drop: true });
  assert.equal(primaryReason(all), 'price');
  assert.equal(primaryReason({ pct: true, price: false, drop: true }), 'pct');
  assert.equal(primaryReason({ pct: false, price: false, drop: true }), 'drop');
  assert.equal(primaryReason({ pct: false, price: false, drop: false }), null);
});

test('discountPct is rounded and guards a zero baseline', () => {
  assert.equal(discountPct(120, 200), 40);
  assert.equal(discountPct(133, 200), 34); // 33.5 → 34
  assert.equal(discountPct(50, 0), 0);
});
