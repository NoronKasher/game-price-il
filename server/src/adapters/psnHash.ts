import { chromium, type Browser } from 'playwright-core';
import { getSetting, setSetting } from '../db.ts';

/**
 * Keeping PlayStation working when Sony rotates its persisted-query hash.
 *
 * WHAT WAS RULED OUT, so nobody re-treads it:
 *
 *  - Sending the full query instead of a hash. PSN answers `{"message":"Query
 *    not whitelisted"}`. This is a server-side allowlist of specific hashes, not
 *    ordinary Apollo APQ, so no client-side cleverness substitutes for a hash
 *    they already registered.
 *  - Scraping search results instead. The search page is client-rendered — its
 *    `__NEXT_DATA__` carries only the search term, no products and no Apollo
 *    cache. (Product PAGES do still server-render their price, which is why the
 *    price lookup itself needs no hash; finding a region's product id does.)
 *  - Computing the hash from the shipped JavaScript. The query and its fragments
 *    ARE extractable from the `_app` bundle and the hash is just
 *    sha256(print(document)) — but roughly a hundred assemblies (fragment order,
 *    `__typename` injection, whitespace and print variants) failed to reproduce
 *    the known-good hash from the very bundle version that produced it. A rule
 *    that cannot reproduce today's hash cannot be trusted to produce tomorrow's.
 *
 * WHAT WORKS, and is on by default: run the store's own JavaScript and read the
 * hash out of the request it makes. Correct by construction, and it stays
 * correct however Apollo changes. This is not a circumvention of anything — it
 * is being a browser, on a public page, exactly as a visitor is.
 *
 * The cost is kept small on purpose. `playwright-core` is a few megabytes and
 * downloads NO browser of its own; it drives a Chromium-family browser the
 * machine already has (Edge ships with Windows, and Chrome is near-universal
 * elsewhere). If none is found the discovery simply fails and the manual
 * PSN_SEARCH_HASH override still applies — a missing browser degrades the
 * recovery, never the app.
 */

const SETTING_KEY = 'psn_search_hash';
const LAST_TRY_KEY = 'psn_hash_last_attempt';
/** Never re-attempt discovery more often than this — it starts a browser. */
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Installed browsers to try, in order. These are channels rather than bundled
 * downloads: Playwright resolves each to the real application on disk and fails
 * immediately (a path check) when it isn't there, so listing several costs
 * nothing. `chromium` last picks up a Playwright-managed browser for anyone who
 * has run `playwright install`.
 */
const CHANNELS = ['chrome', 'msedge', 'chromium'] as const;

const SEARCH_PAGE = 'https://store.playstation.com/en-us/search/stray';

export function hashDiscoveryDue(): boolean {
  const last = Number(getSetting(LAST_TRY_KEY));
  if (!Number.isFinite(last) || last <= 0) return true;
  return Date.now() - last >= RETRY_COOLDOWN_MS;
}

/** The persisted-query hash out of a store request URL, if that's what it is. */
function hashFromUrl(raw: string): string | null {
  if (!raw.includes('/api/graphql/')) return null;
  try {
    const url = new URL(raw);
    if (url.searchParams.get('operationName') !== 'getSearchResults') return null;
    const ext = url.searchParams.get('extensions');
    if (!ext) return null;
    const hash = (JSON.parse(ext) as { persistedQuery?: { sha256Hash?: string } })?.persistedQuery?.sha256Hash;
    return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

async function launchInstalledBrowser(): Promise<Browser | null> {
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({ headless: true, channel });
    } catch {
      // Not installed under this channel — try the next.
    }
  }
  try {
    // Last resort: whatever Playwright considers the default.
    return await chromium.launch({ headless: true });
  } catch {
    return null;
  }
}

/**
 * One discovery at a time, shared by every caller.
 *
 * When the hash rotates, every region fails at once, so without this the board
 * would try to start a browser per region. Callers get the same promise, and it
 * clears when the attempt settles.
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
 * Load the public store search page in a real browser and capture the hash it
 * sends. Persists and returns it, or null if no browser was available or the
 * page never made the call.
 *
 * Starting a cold browser can take a while — long enough that no user request
 * should ever wait on the whole thing. Callers race it against a short budget
 * (see psn.ts) and let it finish in the background; the recovered hash is
 * persisted, so whatever runs next picks it up.
 */
export async function discoverSearchHash(timeoutMs = 45_000): Promise<string | null> {
  // Stamped before the work, not after, so the concurrent per-region callers
  // that all fail at once trigger at most one browser between them.
  setSetting(LAST_TRY_KEY, String(Date.now()));

  const browser = await launchInstalledBrowser();
  if (!browser) return null;
  try {
    const page = await browser.newPage();
    let found: string | null = null;
    page.on('request', (req) => {
      if (found) return;
      found = hashFromUrl(req.url());
    });

    await page.goto(SEARCH_PAGE, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const deadline = Date.now() + Math.min(timeoutMs, 20_000);
    while (!found && Date.now() < deadline) await page.waitForTimeout(250);

    if (found) setSetting(SETTING_KEY, found);
    return found;
  } catch {
    return null;
  } finally {
    // Shut the browser down WITHOUT waiting for it. Finding the hash takes about
    // three seconds; closing the browser was observed to hang for twelve
    // minutes, and awaiting it here held the answer hostage for that whole time
    // even though it had already been captured and saved. Nothing downstream
    // needs the shutdown, so it is left to finish on its own.
    void browser.close().catch(() => undefined);
  }
}
