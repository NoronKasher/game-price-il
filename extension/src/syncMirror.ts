import {
  exportAll,
  importAll,
  getCaptureDaysGlobal,
  setCaptureDaysGlobal,
  getDisplayCurrency,
  setDisplayCurrency,
  getAlertDefaults,
  setAlertDefaults,
  ready,
} from './db.browser.ts';

/**
 * Carrying the tracked list to the user's other machines — through the browser's
 * own account sync, and nothing else.
 *
 * The problem is real: somebody follows a dozen games for months, gets a new
 * laptop, installs the extension and finds an empty list. The tempting answer is
 * "sign in with Google" — and it does not hold up. Facebook has no file storage
 * for applications at all, so backing anything up there would mean backing it up
 * to a server we run, which this project has never had and does not want. Google
 * does have somewhere (Drive's per-app folder), but that scope needs Google's
 * OAuth verification — a privacy policy, a verified domain, a review — before it
 * works for more than a hundred testers, and it would still leave everyone
 * without a Google account with nothing.
 *
 * `chrome.storage.sync` is the same idea already built into the browser. The
 * user is signed into their browser account; the browser moves the data; we
 * never see a credential, never run an OAuth screen, and never hold anyone's
 * data anywhere. On a browser with sync turned off it quietly degrades to local
 * storage, which loses nothing that was not already lost.
 *
 * WHAT TRAVELS, AND WHAT DOES NOT. The quota is 100KB in 8KB items — small, and
 * not negotiable. The tracked list and the settings fit comfortably. The PRICE
 * HISTORY does not: one real list is around 90KB on its own and grows every
 * week, so putting it here would mean throwing most of it away and calling the
 * remainder a backup. History stays local, and the desktop app's file backup is
 * the answer for people who want to keep it (see desktop/backup.js).
 *
 * MERGE, NEVER DELETE. Two machines can both be running this. A pull adds games
 * the local copy is missing and leaves everything else alone, so nothing you
 * track here can be removed by something that happened elsewhere. The cost is
 * that removing a game does not propagate — a deletion has to be repeated on
 * each machine. That is the right way round: an un-deleted game is a row to
 * remove again, a wrongly-deleted one is months of history gone.
 */

const VERSION = 1;
const META_KEY = 'vgpt_sync_meta';
const CHUNK_PREFIX = 'vgpt_sync_';
/** Under chrome's 8192-byte per-item limit with room for the key and JSON quoting. */
const CHUNK_BYTES = 7000;
/** Chrome allows ~1800 sync writes an hour; this makes bursts of edits one write. */
const PUSH_DEBOUNCE_MS = 20_000;

interface SyncMeta {
  v: number;
  at: string;
  chunks: number;
  /** Games left out because the payload did not fit the quota. 0 in the normal case. */
  dropped: number;
}

interface Payload {
  items: ReturnType<typeof exportAll>;
  settings: {
    captureDaysGlobal: number;
    displayCurrency: string;
    alerts: ReturnType<typeof getAlertDefaults>;
  };
}

/** Is there a sync area to use at all? False in tests, and in a plain web page. */
function area(): chrome.storage.SyncStorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.sync ? chrome.storage.sync : null;
}

/**
 * What we would send. History is stripped here rather than at the source: the
 * tracked game, its stores and the user's per-game choices are what make the
 * list, and they are a hundredth of the size.
 */
function payload(): Payload {
  return {
    items: exportAll().map((item) => ({ ...item, history: [] })),
    settings: {
      captureDaysGlobal: getCaptureDaysGlobal(),
      displayCurrency: getDisplayCurrency(),
      alerts: getAlertDefaults(),
    },
  };
}

/** Split a string into chunks small enough for one sync item each. */
function chunk(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_BYTES) out.push(text.slice(i, i + CHUNK_BYTES));
  return out;
}

/**
 * Serialise, dropping the most recently added games first if the quota is not
 * enough. Newest-first because the oldest entries are the ones with the most
 * history behind them on some machine — the ones worth keeping addressable.
 */
function serialise(data: Payload): { text: string; dropped: number } {
  const budget = 95_000; // chrome's 102,400 total, less room for keys and overhead
  let items = data.items;
  let dropped = 0;
  for (;;) {
    const text = JSON.stringify({ ...data, items });
    if (text.length <= budget || items.length === 0) return { text, dropped };
    items = items.slice(0, -1);
    dropped++;
  }
}

const setSync = (values: Record<string, unknown>) =>
  new Promise<void>((resolve, reject) => {
    area()!.set(values, () => (chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()));
  });

const getSync = (keys: string[] | null) =>
  new Promise<Record<string, unknown>>((resolve) => {
    area()!.get(keys as string[], (v) => resolve(chrome.runtime.lastError ? {} : v));
  });

const removeSync = (keys: string[]) =>
  new Promise<void>((resolve) => {
    area()!.remove(keys, () => resolve());
  });

/** The last thing we wrote, so an unrelated change (a price point) writes nothing. */
let lastPushed: string | null = null;
/** What we last applied FROM sync, so our own echo does not start a pull. */
let lastPulled: string | null = null;

export async function pushToSync(): Promise<void> {
  if (!area()) return;
  await ready();
  const { text, dropped } = serialise(payload());
  if (text === lastPushed) return;

  const parts = chunk(text);
  const values: Record<string, unknown> = {};
  parts.forEach((part, i) => (values[`${CHUNK_PREFIX}${i}`] = part));
  const meta: SyncMeta = { v: VERSION, at: new Date().toISOString(), chunks: parts.length, dropped };
  values[META_KEY] = meta;

  try {
    await setSync(values);
    // Chunks left over from a longer previous list would otherwise be read back
    // as trailing garbage on the next pull.
    const stale: string[] = [];
    const existing = await getSync(null);
    for (const key of Object.keys(existing)) {
      if (!key.startsWith(CHUNK_PREFIX)) continue;
      const index = Number(key.slice(CHUNK_PREFIX.length));
      if (Number.isFinite(index) && index >= parts.length) stale.push(key);
    }
    if (stale.length) await removeSync(stale);

    lastPushed = text;
    lastPulled = text;
    if (dropped > 0) {
      console.warn(`sync: the tracked list is larger than the browser's sync quota — ${dropped} game(s) not synced`);
    }
  } catch (err) {
    // A full quota, or sync switched off. Neither is worth failing anything over:
    // everything is still here, locally, exactly as before.
    console.warn(`sync: could not write the tracked list — ${err instanceof Error ? err.message : err}`);
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/** Coalesce a burst of edits into one sync write. Safe to call on every change. */
export function scheduleSyncPush(): void {
  if (!area()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushToSync();
  }, PUSH_DEBOUNCE_MS);
}

/**
 * Take whatever the other machines have and add anything missing here.
 *
 * Returns how many games were added, so the caller can say so. Settings are only
 * adopted when this device has never pulled before — otherwise a preference
 * someone set here would be overwritten every time another machine synced.
 */
export async function pullFromSync(): Promise<{ games: number }> {
  if (!area()) return { games: 0 };
  await ready();
  const stored = await getSync([META_KEY]);
  const meta = stored[META_KEY] as SyncMeta | undefined;
  if (!meta || meta.v !== VERSION || !meta.chunks) return { games: 0 };

  const keys = Array.from({ length: meta.chunks }, (_, i) => `${CHUNK_PREFIX}${i}`);
  const parts = await getSync(keys);
  let text = '';
  for (const key of keys) {
    const part = parts[key];
    if (typeof part !== 'string') return { games: 0 }; // a partial write; wait for the next one
    text += part;
  }
  if (text === lastPulled) return { games: 0 };

  let data: Payload;
  try {
    data = JSON.parse(text) as Payload;
  } catch {
    console.warn('sync: the synced list could not be read');
    return { games: 0 };
  }

  // importAll runs the same sanitiser the file import does. That matters: this
  // data arrived from another machine, and "another machine of mine" is still
  // not a reason to trust a blob into the database unchecked.
  const { games } = importAll({ version: 1, items: data.items ?? [] });

  if (lastPulled === null && data.settings) {
    if (typeof data.settings.captureDaysGlobal === 'number') setCaptureDaysGlobal(data.settings.captureDaysGlobal);
    if (typeof data.settings.displayCurrency === 'string') setDisplayCurrency(data.settings.displayCurrency);
    if (data.settings.alerts) setAlertDefaults(data.settings.alerts);
  }

  lastPulled = text;
  if (games > 0) console.log(`sync: brought ${games} tracked game(s) over from another browser`);
  return { games };
}

/**
 * Start mirroring. Pulls once now, then follows both directions: local edits are
 * pushed on a debounce, and another machine's push arrives as a storage event.
 */
/** Test seam: forget what this worker believes it has already sent and received. */
export function __resetSyncState(): void {
  lastPushed = null;
  lastPulled = null;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
}

export function startSyncMirror(): void {
  if (!area()) return;
  void pullFromSync();
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !(META_KEY in changes)) return;
    void pullFromSync();
  });
}
