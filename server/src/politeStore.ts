import { getSetting, setSetting } from './db.ts';
import type { HostState, PoliteStore } from './adapters/politeFetch.ts';

/**
 * The per-host rate limits, kept in the database instead of in memory.
 *
 * politeFetch's default store is process memory, on the reasoning that a server
 * process outlives the work it does. That reasoning does not survive how this
 * tool is actually run:
 *
 *  - The DESKTOP APP restarts every time the machine is turned on, and it is
 *    built to start at login. Its first act after every boot is a fresh 200 per
 *    host, whatever it spent yesterday.
 *  - The DEMO CAPTURE is a series of runs against a server that gets restarted
 *    between them, so "run again tomorrow to continue" could be defeated by
 *    running again in five minutes.
 *  - Development restarts the server constantly.
 *
 * Every one of those quietly resets the counter, which means the promise this
 * project makes to the shops — a minimum gap, a daily budget, a stand-down after
 * a refusal — held only for as long as one process happened to live. Nothing
 * would ever have errored; we would simply have been scraping harder than we
 * said, which is the exact failure politeFetch exists to prevent. The extension
 * already persists this (extension/src/politeStorage.ts); the server had the
 * weaker guarantee of the two, on the machine that runs unattended.
 *
 * The back-off is the part that matters most. A store that answered 429 and
 * asked us to wait an hour was being obeyed only until the next restart.
 */

const PREFIX = 'polite:';

/** Anything malformed is treated as absent — a corrupt row must not disable the limits. */
function parse(raw: string | null): HostState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<HostState>;
    if (typeof v.day !== 'string') return null;
    return {
      day: v.day,
      count: Number.isFinite(v.count) ? Number(v.count) : 0,
      pausedUntil: Number.isFinite(v.pausedUntil) ? Number(v.pausedUntil) : 0,
      lastAt: Number.isFinite(v.lastAt) ? Number(v.lastAt) : 0,
    };
  } catch {
    return null;
  }
}

export const sqlitePoliteStore: PoliteStore = {
  async get(host: string): Promise<HostState | null> {
    return parse(getSetting(PREFIX + host));
  },
  async set(host: string, state: HostState): Promise<void> {
    setSetting(PREFIX + host, JSON.stringify(state));
  },
};
