import type { HostState, PoliteStore } from '../../server/src/adapters/politeFetch.ts';

/**
 * The per-host rate-limit state, kept where a dying service worker cannot lose it.
 *
 * MV3 terminates the worker after roughly 30 seconds of inactivity and starts a
 * fresh one on the next event. Every promise this tool makes a store — 2.5s
 * between requests, 200 requests a day, three hours of standing down after a
 * 429 — was held in module memory, which that restart wipes clean. The failure
 * mode is the worst kind: nothing errors, the numbers simply reset and we start
 * scraping harder than we said we would.
 *
 * chrome.storage.local survives worker restarts and browser restarts, which is
 * the only place this state can honestly live.
 */

const PREFIX = 'polite:';

/** A read-modify-write per request is fine: one request per host per 2.5s. */
export const chromeStoragePoliteStore: PoliteStore = {
  async get(host: string): Promise<HostState | null> {
    const key = PREFIX + host;
    const bag = await chrome.storage.local.get(key);
    return (bag[key] as HostState | undefined) ?? null;
  },

  async set(host: string, state: HostState): Promise<void> {
    await chrome.storage.local.set({ [PREFIX + host]: state });
  },
};

/** Everything the limiter currently remembers — for the diagnostics panel. */
export async function politeSnapshot(): Promise<Record<string, HostState>> {
  const all = await chrome.storage.local.get(null);
  const out: Record<string, HostState> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(PREFIX)) out[key.slice(PREFIX.length)] = value as HostState;
  }
  return out;
}
