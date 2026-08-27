import { getSetting, setSetting } from './db.browser.ts';

/**
 * PlayStation persisted-query hash — the extension's stand-in for psnHash.ts.
 *
 * The server recovers a rotated hash by driving a real browser with Playwright.
 * An extension cannot import Playwright and does not need to: it already IS a
 * browser. It opens the store's own public search page in a background tab and
 * reads the hash out of the request the page makes, then closes the tab.
 *
 * HOW THE HASH IS READ, and why this route rather than the obvious ones:
 *
 *  - NOT from the shipped JavaScript. Checked, on the live store: across all
 *    ten chunks the search page loads — a megabyte of `_app` included — there
 *    are ZERO 64-character hex strings. The hash is not a constant in the
 *    bundle; Apollo computes it at request time from the query document. So
 *    there is nothing to fetch-and-regex, which would otherwise have been the
 *    cheapest possible recovery and would have worked with no tab at all.
 *  - NOT chrome.webRequest. Watching somebody's traffic is a large permission
 *    to hold forever for something that runs when Sony ships a deploy.
 *  - NOT a MAIN-world script patching window.fetch. Injecting into the page's
 *    own context to intercept its calls is more power than the job needs.
 *
 *  - performance.getEntriesByType('resource'). The page records every request
 *    it made, `name` is the full URL, and the hash travels in that URL's query
 *    string. A cross-origin entry hides its TIMINGS without Timing-Allow-Origin
 *    but never its URL, which is the only field wanted here. Verified against
 *    the live page: two GraphQL entries, `getSearchResults` among them, hash
 *    intact. An ordinary content script in the isolated world can read it.
 *
 * This is not a circumvention of anything. It is a visit to a public page,
 * made by the user's own browser, reading what that page recorded about itself.
 * One tab, only when the stored hash has actually been refused, at most once
 * per cooldown.
 */

const SETTING_KEY = 'psn_search_hash';
const LAST_TRY_KEY = 'psn_hash_last_attempt';
/** Never re-attempt more often than this — it opens a tab in someone's browser. */
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const SEARCH_PAGE = 'https://store.playstation.com/en-us/search/stray';
const SEARCH_OP = 'getSearchResults';

/** How long to keep asking the page what it has requested so far. */
const POLL_ATTEMPTS = 30;
const POLL_GAP_MS = 500;

export function hashDiscoveryDue(): boolean {
  const last = Number(getSetting(LAST_TRY_KEY));
  if (!Number.isFinite(last) || last <= 0) return true;
  return Date.now() - last >= RETRY_COOLDOWN_MS;
}

/**
 * Runs INSIDE the store page. Must be self-contained — it is serialised and
 * injected, so it closes over nothing from this module.
 */
function readHashFromPage(operationName: string): string | null {
  for (const entry of performance.getEntriesByType('resource')) {
    const raw = entry.name;
    if (!raw.includes('/api/graphql/')) continue;
    try {
      const url = new URL(raw);
      if (url.searchParams.get('operationName') !== operationName) continue;
      const ext = url.searchParams.get('extensions');
      if (!ext) continue;
      const hash = (JSON.parse(ext) as { persistedQuery?: { sha256Hash?: string } })?.persistedQuery?.sha256Hash;
      if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) return hash;
    } catch {
      // A URL or a payload that does not parse is simply not the one.
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function discoverSearchHash(): Promise<string | null> {
  // Stamped before the work, not after: every region fails at once when the
  // hash rotates, so without this each one would try to open its own tab.
  setSetting(LAST_TRY_KEY, String(Date.now()));

  // `scripting` is the one permission this needs; the host permission for the
  // store is already held for the price lookups themselves.
  if (!chrome.scripting || !chrome.tabs) return null;

  let tabId: number | undefined;
  try {
    // Background tab, not a window: it does not steal focus, and Chrome still
    // loads and runs it normally. Discarded tabs would not run the page at all,
    // which is why this is a real tab rather than anything cheaper.
    const tab = await chrome.tabs.create({ url: SEARCH_PAGE, active: false });
    tabId = tab.id;
    if (tabId === undefined) return null;

    for (let i = 0; i < POLL_ATTEMPTS; i++) {
      await sleep(POLL_GAP_MS);
      let results;
      try {
        results = await chrome.scripting.executeScript({
          target: { tabId },
          func: readHashFromPage,
          args: [SEARCH_OP],
        });
      } catch {
        // The page is still navigating, or not injectable yet. Both resolve on
        // a later attempt; a throw here is not a reason to give up the whole
        // recovery.
        continue;
      }
      const hash = results?.[0]?.result;
      if (typeof hash === 'string') {
        setSetting(SETTING_KEY, hash);
        noteHashSaved();
        return hash;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    // Always, including on the paths that found nothing — a tab left open in
    // somebody's browser because a recovery failed is the worst outcome here.
    if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

/**
 * One discovery at a time, shared by every caller — mirrors the server.
 *
 * Without it the sixteen-region fan-out would open sixteen tabs, which is the
 * kind of thing that gets an extension uninstalled.
 */
let inFlight: Promise<string | null> | null = null;

export function discoverSearchHashShared(): Promise<string | null> {
  if (!inFlight) {
    inFlight = discoverSearchHash().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Whether recovery is possible at all, answered without doing it.
 *
 * The server probes by starting a browser; here it is a permission check, which
 * is free. False means an older Chrome or a manifest that has not been reloaded
 * since `scripting` was added — and then the manual paste in Settings is still
 * there, exactly as before.
 */
export async function probeBrowser(): Promise<string | null> {
  return chrome.scripting && chrome.tabs ? 'this browser' : null;
}

/**
 * The rejection bookkeeping the server keeps, kept here too.
 *
 * psn.ts sets the flag on a refusal before deciding whether the cooldown lets
 * it act, so the signal is accurate even on the attempts that are declined.
 */
let rejectedAt = 0;
let savedAt = 0;

export function noteHashRejected(): void {
  rejectedAt = Date.now();
}
export function noteHashSaved(): void {
  savedAt = Date.now();
}
export function hashNeedsRecovery(): boolean {
  return rejectedAt > 0 && rejectedAt > savedAt;
}
