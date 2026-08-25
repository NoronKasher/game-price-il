import type { Browser, BrowserType } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Playwright is loaded on demand, never at import time.
 *
 * A packaged desktop build bundles the server into one file and cannot carry
 * Playwright with it — it resolves paths to a browser on disk at runtime, which
 * no bundler can follow. A static import would therefore stop the whole server
 * from starting on a machine without it, to protect a feature that only matters
 * when Sony rotates a hash. Absent, PlayStation simply keeps using the hash it
 * already has.
 */
async function playwright(): Promise<{
  chromium: BrowserType;
  firefox: BrowserType;
  webkit: BrowserType;
} | null> {
  try {
    return await import('playwright-core');
  } catch {
    return null;
  }
}
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
 * elsewhere).
 *
 * WHICH BROWSER THE USER PREFERS IS IRRELEVANT — this is a background tool, not
 * their browsing. Someone who lives in Firefox on Windows still has Edge for us
 * to drive. What matters is only whether SOME driveable engine exists on the
 * machine, and there are three tiers:
 *   1. A system Chromium-family browser (chrome / msedge / chromium channels).
 *      Always true on Windows; near-always elsewhere.
 *   2. A Playwright-managed engine, for anyone who has run `playwright install`
 *      — including firefox and webkit. NOTE these are Playwright's own patched
 *      builds; an installed Firefox or Safari cannot be driven, so this tier is
 *      opt-in rather than something we can assume.
 *   3. Nobody. Then discovery returns null and the hash is set by hand in
 *      Settings, which works on any machine and takes half a minute.
 * A missing browser degrades the recovery, never the app.
 */

const SETTING_KEY = 'psn_search_hash';
const LAST_TRY_KEY = 'psn_hash_last_attempt';
/** Never re-attempt discovery more often than this — it starts a browser. */
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Whether the hash in use is currently being refused, so a host that has its
 * own browser can offer to go and get a fresh one.
 *
 * The desktop build is exactly that host: it IS a Chromium, but the server it
 * runs is a bundled single file that cannot carry playwright-core, so the
 * recovery above finds no engine and gives up. Rather than teach the server
 * about Electron, it reports the need and Electron watches for it — which keeps
 * PlayStation untouched until the hash actually breaks. Polling a store on a
 * schedule to see whether we still work would be the rude version of this.
 *
 * In memory on purpose: a rejection is a fact about the live hash, and the very
 * next search after a restart re-establishes it.
 */
let rejectedAt = 0;
let savedAt = 0;

export function noteHashRejected(): void {
  rejectedAt = Date.now();
}
/** Called whenever a new hash is stored, by hand or by any discovery route. */
export function noteHashSaved(): void {
  savedAt = Date.now();
}
export function hashNeedsRecovery(): boolean {
  return rejectedAt > 0 && rejectedAt > savedAt;
}

/**
 * Wait for a hash to be stored by somebody else, or give up.
 *
 * Used when the request cannot do the recovery itself and has handed the job to
 * the shell around it (see the desktop branch of /api/psn-hash/recover). The
 * shell saves the hash through the normal PATCH route, which is what wakes this.
 */
export function waitForHashSaved(timeoutMs: number): Promise<boolean> {
  const before = savedAt;
  const started = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (savedAt > before) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 250);
  });
}

/**
 * Printed to stdout when the server wants its host to recover the hash for it.
 *
 * The desktop app spawns this server as a child process and already pipes and
 * reads its stdout, so that pipe is a channel that exists rather than one that
 * has to be built. desktop/main.js watches for this exact string — change one
 * and change the other.
 */
export const HOST_RECOVER_MARKER = '__VGPT_PSN_RECOVER__';

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

/** Which engine we managed to start, for reporting in Settings. */
export type BrowserEngine = string;

/**
 * Chromium-family browsers that are NOT Chrome or Edge.
 *
 * Playwright's `channel` option resolves a fixed set of known applications —
 * Chrome, Edge, and its own downloaded builds. It has no idea what Brave,
 * Vivaldi, Opera, Arc or Perplexity's Comet are, even though every one of them
 * is Chromium underneath and drives perfectly well through `executablePath`.
 *
 * That gap produced a genuinely insulting message: someone reading "no
 * Chromium-based browser was found on this machine" inside a Chromium-based
 * browser.
 *
 * Anything found here is only a CANDIDATE. Whether it can actually be driven is
 * settled by trying to start it, which costs a failed spawn and nothing else.
 */
function registeredBrowsers(): { name: string; path: string }[] {
  if (process.platform !== 'win32') return [];

  // Chromium's own installer lays every build out the same way:
  //   <vendor>\<product>\Application\<name>.exe
  // Verified against three different browsers on one machine —
  //   BraveSoftware\Brave-Browser\Application\brave.exe
  //   Perplexity\Comet\Application\comet.exe
  //   Microsoft\Edge\Application\msedge.exe
  // — which is why this looks for the SHAPE rather than for known names. A list
  // of names is out of date the moment somebody ships a new browser, and this
  // whole function exists because that already happened.
  const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .filter((r): r is string => Boolean(r));

  const found = new Map<string, string>();
  const collect = (dir: string) => {
    const appDir = path.join(dir, 'Application');
    let entries: string[];
    try {
      entries = fs.readdirSync(appDir);
    } catch {
      return; // no Application/ here
    }
    for (const file of entries) {
      if (!file.toLowerCase().endsWith('.exe')) continue;
      const name = path.basename(file, path.extname(file)).toLowerCase();
      // Chrome and Edge are already covered by their channels above.
      if (['chrome', 'msedge'].includes(name)) continue;
      // A Chromium install ships a crowd of helper binaries beside the browser —
      // *_proxy, pwahelper, the crash reporter, the updater. Each one accepts
      // being launched and then exits, so without this every candidate list ends
      // in four or five pointless spawns that each take a couple of seconds to
      // fail. Observed on one machine: 3 real browsers, 4 helpers.
      if (/_proxy$|helper|crashpad|setup|elevation|updater|notification/.test(name)) continue;
      if (!found.has(name)) found.set(name, path.join(appDir, file));
    }
  };

  const listDirs = (dir: string): string[] => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name));
    } catch {
      return [];
    }
  };

  // Two levels: <root>\<product>\Application and <root>\<vendor>\<product>\Application.
  // Bounded on purpose — an unbounded walk of Program Files is not something to
  // do on the way to answering "can we recover a hash".
  for (const root of roots) {
    for (const vendor of listDirs(root)) {
      collect(vendor);
      for (const product of listDirs(vendor)) collect(product);
    }
  }
  return [...found].map(([name, exe]) => ({ name, path: exe }));
}

async function launchInstalledBrowser(): Promise<{ browser: Browser; engine: BrowserEngine } | null> {
  const pw = await playwright();
  if (!pw) return null;
  const { chromium, firefox, webkit } = pw;
  // An explicit choice always wins — the escape hatch for a browser installed
  // somewhere nothing can be expected to guess.
  const override = process.env.VGPT_BROWSER_PATH?.trim();
  if (override) {
    try {
      return {
        browser: await chromium.launch({ headless: true, executablePath: override }),
        engine: path.basename(override, path.extname(override)),
      };
    } catch (err) {
      console.error(`VGPT_BROWSER_PATH is set but could not be started: ${(err as Error).message}`);
    }
  }

  for (const channel of CHANNELS) {
    try {
      return { browser: await chromium.launch({ headless: true, channel }), engine: channel };
    } catch {
      // Not installed under this channel — try the next.
    }
  }

  // Whatever else this machine has. Brave, Vivaldi, Opera, Arc, Comet — all
  // Chromium, none of them things Playwright's channel list has heard of.
  for (const { name, path: exe } of registeredBrowsers()) {
    try {
      return { browser: await chromium.launch({ headless: true, executablePath: exe }), engine: name };
    } catch {
      // Not a Chromium after all, or refuses to start headless — try the next.
    }
  }

  // Playwright-managed engines, present only if `playwright install` was run.
  for (const [engine, type] of [
    ['chromium', chromium],
    ['firefox', firefox],
    ['webkit', webkit],
  ] as const) {
    try {
      return { browser: await type.launch({ headless: true }), engine };
    } catch {
      // Not downloaded — try the next.
    }
  }
  return null;
}

/**
 * Can this machine recover the hash on its own? Answered by actually starting a
 * browser and closing it, because "is Chrome installed" is not a question with a
 * reliable answer from a path check alone. Used by Settings so the user learns
 * their status before something breaks, not after.
 */
let probeCache: { engine: BrowserEngine | null; at: number } | null = null;
const PROBE_TTL_MS = 60 * 60 * 1000;

export async function probeBrowser(): Promise<BrowserEngine | null> {
  // Cached: the Settings page asks on every open, and the answer only changes
  // when someone installs or removes a browser. Starting one each time would
  // make opening Settings pay for a browser launch.
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.engine;
  const launched = await launchInstalledBrowser();
  const engine = launched?.engine ?? null;
  if (launched) void launched.browser.close().catch(() => undefined);
  probeCache = { engine, at: Date.now() };
  return engine;
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

  const launched = await launchInstalledBrowser();
  if (!launched) return null;
  const { browser } = launched;
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

    if (found) {
      setSetting(SETTING_KEY, found);
      noteHashSaved();
    }
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
