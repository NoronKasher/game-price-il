import { getSetting, setSetting } from '../db.ts';

/**
 * Recovering PlayStation's persisted-query hash automatically.
 *
 * WHAT WAS RULED OUT, so nobody re-treads it:
 *
 *  - Sending the full query instead of a hash. PSN answers `{"message":"Query
 *    not whitelisted"}`. This is a server-side allowlist of specific hashes, not
 *    ordinary Apollo APQ, so no amount of client cleverness substitutes for a
 *    hash they already know. It also means the endpoint is a perfect oracle: it
 *    will tell you whether a candidate hash is on the list.
 *  - Scraping search results instead. The search page is client-rendered — its
 *    `__NEXT_DATA__` carries only the search term, no products and no Apollo
 *    cache. (Product PAGES do still server-render their price, which is why the
 *    price half of this adapter needs no hash at all.)
 *  - Deriving the hash from the shipped JavaScript. The query and its fragments
 *    ARE extractable from the `_app` bundle, and the hash is simply
 *    sha256(print(document)) — but roughly a hundred assemblies (fragment order,
 *    `__typename` injection, whitespace and print variants) failed to reproduce
 *    the known-good hash from the very bundle version that produced it. The
 *    inputs are right; Apollo's exact document transform is not reconstructable
 *    by inspection, and a rule that cannot reproduce today's hash cannot be
 *    trusted to produce tomorrow's.
 *
 * WHAT ACTUALLY WORKS: run the store's own JavaScript and read the request it
 * makes. That is correct by construction and stays correct however Apollo
 * changes, and it is not a circumvention of anything — it is being a browser,
 * doing exactly what a visitor's browser does on a public page.
 *
 * Playwright is NOT a dependency of this project; a 300MB browser download is a
 * poor trade for a value that changes maybe once a year. It is imported lazily,
 * so this returns null when it isn't installed and the adapter falls back to the
 * PSN_SEARCH_HASH env var / `psn_search_hash` setting. Install it with
 * `npm i -D playwright` if you want the recovery to be automatic.
 */

const SETTING_KEY = 'psn_search_hash';
const LAST_TRY_KEY = 'psn_hash_last_attempt';
/** Never re-attempt discovery more often than this — it launches a browser. */
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export function hashDiscoveryDue(): boolean {
  const last = Number(getSetting(LAST_TRY_KEY));
  if (!Number.isFinite(last) || last <= 0) return true;
  return Date.now() - last >= RETRY_COOLDOWN_MS;
}

/**
 * Drive a real browser over the public store search page and capture the
 * `sha256Hash` it sends for getSearchResults. Returns null when Playwright
 * isn't installed, or nothing was captured in time.
 */
export async function discoverSearchHash(timeoutMs = 45_000): Promise<string | null> {
  setSetting(LAST_TRY_KEY, String(Date.now()));

  // Structural types only: `playwright` is not installed by default, so naming
  // its types would break the build for everyone who hasn't opted in.
  interface PwPage {
    on(event: 'request', cb: (req: { url(): string }) => void): void;
    goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
    waitForTimeout(ms: number): Promise<void>;
  }
  interface PwBrowser {
    newPage(): Promise<PwPage>;
    close(): Promise<void>;
  }
  interface PwModule {
    chromium: { launch(opts: { headless: boolean }): Promise<PwBrowser> };
  }

  let chromium: PwModule['chromium'];
  try {
    // The specifier is held in a variable so the compiler doesn't try to resolve
    // a module that is intentionally absent — this has to build on an install
    // where Playwright was never added.
    const specifier = 'playwright';
    const mod = (await import(specifier)) as unknown as PwModule;
    chromium = mod.chromium;
  } catch {
    return null;
  }

  let browser: PwBrowser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    let found: string | null = null;
    page.on('request', (req) => {
      if (found) return;
      const url = req.url();
      if (!url.includes('/api/graphql/') || !url.includes('getSearchResults')) return;
      // The store sends the persisted-query extension in the query string.
      const ext = new URL(url).searchParams.get('extensions');
      if (!ext) return;
      try {
        const hash = JSON.parse(ext)?.persistedQuery?.sha256Hash;
        if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) found = hash;
      } catch {
        /* not the shape we expected */
      }
    });

    await page.goto('https://store.playstation.com/en-us/search/stray', {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    // Give the client a moment to fire its search call.
    const deadline = Date.now() + Math.min(timeoutMs, 20_000);
    while (!found && Date.now() < deadline) await page.waitForTimeout(250);

    if (found) setSetting(SETTING_KEY, found);
    return found;
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
