import type { Platform } from './search.ts';
import type { SourceAdapter } from './adapters/types.ts';
import { RateLimitedError } from './adapters/politeFetch.ts';
import { getSetting, setSetting } from './db.ts';

/**
 * Adapter health canary.
 *
 * Sixteen sources, most of them reading someone else's HTML. When a store
 * redesigns, its parser doesn't throw — it quietly matches nothing, and the
 * board shows no row for that store. That is indistinguishable from "this game
 * isn't sold there", so a source can stay dead for weeks without anyone
 * noticing. This runs each adapter against a title it certainly stocks and
 * records whether anything came back.
 *
 * The canary makes REAL requests to real shops, so it is deliberately frugal:
 * once a day at most, one adapter at a time with a pause between, one search
 * each (never a full price fan-out), and the physical stores still go through
 * politeFetch's own spacing and daily budget on top. A monitor that hammered
 * the shops to check they were happy would be its own kind of rude.
 */

/**
 * What to search, per platform, when probing an adapter. Chosen to be games the
 * store almost certainly carries, so "no results" means the adapter is broken
 * rather than the catalogue being thin.
 */
const PROBES: Record<Platform, string> = {
  pc: 'elden ring',
  ps5: 'god of war',
  ps4: 'god of war',
  xbox: 'forza horizon',
  switch: 'zelda',
};

/** Give a probe longer than a UI search would wait; a slow store isn't a dead one. */
const PROBE_TIMEOUT_MS = 45_000;
/** Pause between adapters so a health run is a trickle, not a burst. */
const GAP_MS = 2_000;
/** Never auto-run more often than this. */
export const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

const LAST_RUN_KEY = 'health_last_run';
const REPORT_KEY = 'health_report';

export type HealthState = 'ok' | 'empty' | 'error' | 'rate_limited' | 'disabled';

export interface AdapterHealth {
  id: string;
  name: string;
  state: HealthState;
  /** Hits the probe returned (0 with state 'empty' is the silent-failure case). */
  count: number;
  ms: number;
  /** Probe used, so a human can reproduce the check by hand. */
  probe: string;
  detail?: string;
}

export interface HealthReport {
  checkedAt: string;
  adapters: AdapterHealth[];
}

function firstPlatform(a: SourceAdapter): Platform {
  return a.platforms[0] ?? 'pc';
}

/** Probe one adapter. Never throws — a failed probe IS the result. */
export async function checkAdapter(adapter: SourceAdapter): Promise<AdapterHealth> {
  const platform = firstPlatform(adapter);
  // A store that only sells its own publisher's catalogue needs its own probe:
  // Ubisoft has never sold Elden Ring, so "no results" there would prove nothing.
  const probe = adapter.healthProbe ?? PROBES[platform];
  const base = { id: adapter.id, name: adapter.nameHe, probe, count: 0 };
  // A source gated behind a missing API key is off on purpose, not broken.
  if (!adapter.enabled) return { ...base, state: 'disabled', ms: 0 };

  const started = Date.now();
  // The timer must be cleared on the winning path too. Left dangling it keeps
  // the event loop alive for its full duration after the probe has finished —
  // which turned the test suite from half a second into forty-five, and would
  // have parked a live timer per adapter on every scheduled run.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Companion sources have no search of their own — probing that would report
    // every one of them as broken. They are exercised through getOffers with a
    // known id instead, which is the path they actually serve.
    const work =
      adapter.companion && adapter.healthProbeId
        ? adapter.getOffers(adapter.healthProbeId, platform).then((offers) => offers.length)
        : adapter.search(probe, [platform]).then((hits) => hits.length);
    const count = await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS);
      }),
    ]);
    const ms = Date.now() - started;
    // The whole point: zero hits for a game this store stocks is the silent
    // failure mode, so it gets its own state rather than counting as success.
    return { ...base, state: count > 0 ? 'ok' : 'empty', count, ms };
  } catch (err) {
    const ms = Date.now() - started;
    if (err instanceof RateLimitedError) {
      return { ...base, state: 'rate_limited', ms, detail: err.message };
    }
    return { ...base, state: 'error', ms, detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe every adapter, one at a time, and persist the report. */
export async function runHealthCheck(sources: SourceAdapter[]): Promise<HealthReport> {
  const adapters: AdapterHealth[] = [];
  for (let i = 0; i < sources.length; i++) {
    adapters.push(await checkAdapter(sources[i]!));
    if (i < sources.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
  }
  const report: HealthReport = { checkedAt: new Date().toISOString(), adapters };
  setSetting(REPORT_KEY, JSON.stringify(report));
  setSetting(LAST_RUN_KEY, String(Date.now()));
  return report;
}

/** The last stored report, or null if the canary has never run. */
export function lastHealthReport(): HealthReport | null {
  const raw = getSetting(REPORT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as HealthReport;
    return Array.isArray(parsed?.adapters) ? parsed : null;
  } catch {
    return null;
  }
}

/** Has enough time passed to justify another round of real requests? */
export function healthCheckDue(): boolean {
  const last = Number(getSetting(LAST_RUN_KEY));
  if (!Number.isFinite(last) || last <= 0) return true;
  return Date.now() - last >= MIN_INTERVAL_MS;
}
