export type ApiKeyName = 'ggdeals' | 'itad' | 'steam';
export type ApiKeySource = 'settings' | 'env' | 'file' | 'none';

/**
 * Bring-your-own-key storage for the extension build.
 *
 * The server reads keys from a settings table, an environment variable, or a
 * file on disk. None of those exist in a browser, and the file path is what
 * dragged `node:fs` — and through it the whole SQLite module — into the
 * extension bundle. Aliasing this module in its place is what keeps the store
 * adapters importable unchanged.
 *
 * The API is deliberately synchronous to match the server's, because
 * `getApiKey` is called from inside adapters mid-request. chrome.storage is
 * async, so the values are cached in memory and refreshed in the background:
 * a key that was just pasted is live on the next request rather than this one,
 * which for a credential that changes once is the right trade.
 */

const STORAGE_KEY = 'apiKeys';

let cache: Record<ApiKeyName, string> = { ggdeals: '', itad: '', steam: '' };

/** Load once at worker start; every wake-up re-runs module scope, so this is fresh. */
const ready = (async () => {
  try {
    const bag = await chrome.storage.local.get(STORAGE_KEY);
    const saved = bag[STORAGE_KEY] as Partial<Record<ApiKeyName, string>> | undefined;
    if (saved) cache = { ggdeals: saved.ggdeals ?? '', itad: saved.itad ?? '', steam: saved.steam ?? '' };
  } catch {
    /* no keys configured is a normal state, not an error */
  }
})();

/** Await before the first fan-out so a configured key is not missed on a cold start. */
export function keysReady(): Promise<void> {
  return ready;
}

export function apiKeySource(name: ApiKeyName): ApiKeySource {
  return cache[name] ? 'settings' : 'none';
}

export function getApiKey(name: ApiKeyName): string {
  return cache[name] ?? '';
}

export function hasApiKey(name: ApiKeyName): boolean {
  return Boolean(cache[name]);
}

export function setApiKey(name: ApiKeyName, value: string | null): void {
  cache[name] = value ?? '';
  void chrome.storage.local.set({ [STORAGE_KEY]: { ...cache } });
}
