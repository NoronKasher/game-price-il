const { BrowserWindow, session } = require('electron');

/**
 * Recovering PlayStation's persisted-query hash using the browser we already are.
 *
 * The server's own recovery (server/src/adapters/psnHash.ts) drives an installed
 * Chrome or Edge through playwright-core. That cannot work in the desktop build:
 * the server ships as a single bundled file, and playwright resolves browser
 * paths at runtime in a way no bundler can follow, so the import is absent and
 * discovery returns null. The desktop app would then be the one shape of this
 * tool that could NOT heal itself — while being, of all things, a Chromium.
 *
 * So it heals itself with its own engine. No extra dependency, no download, and
 * no second browser started on the user's machine.
 *
 * WHAT THIS IS NOT: any kind of circumvention. It loads a public store page in a
 * real browser and reads the hash out of the request that page makes, exactly as
 * a visitor's browser does — the same thing the playwright path has always done.
 * The window is hidden because nobody wants a store popping up at them, not to
 * hide anything from Sony: the request carries Electron's normal user agent,
 * which names this application. Nothing here forges a fingerprint, and the page
 * is only ever loaded when the hash we hold has actually been refused.
 */

const SEARCH_PAGE = 'https://store.playstation.com/en-us/search/stray';
const PARTITION = 'vgpt-psn-hash';

/** The persisted-query hash out of a store request URL, if that's what it is. */
function hashFromUrl(raw) {
  if (!raw.includes('/api/graphql/')) return null;
  try {
    const url = new URL(raw);
    if (url.searchParams.get('operationName') !== 'getSearchResults') return null;
    const ext = url.searchParams.get('extensions');
    if (!ext) return null;
    const hash = JSON.parse(ext)?.persistedQuery?.sha256Hash;
    return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Load the store's search page out of sight and capture the hash it sends.
 * Resolves to the hash, or null if the page never made the call in time.
 *
 * One at a time: every PSN region fails at once when the hash rotates, and this
 * is triggered by that failure, so without sharing the attempt a single rotation
 * would open a window per region.
 */
let inFlight = null;

function discoverPsnHash(timeoutMs = 45_000) {
  inFlight ??= runDiscovery(timeoutMs).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runDiscovery(timeoutMs) {
  // A partition of its own, wiped afterwards. This is a tool run, not browsing:
  // it has no business sharing cookies with anything, in either direction.
  const part = session.fromPartition(PARTITION, { cache: false });
  let found = null;

  const watch = (details, callback) => {
    if (!found) found = hashFromUrl(details.url);
    callback({});
  };
  part.webRequest.onBeforeRequest({ urls: ['*://*.playstation.com/*'] }, watch);

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  try {
    // A load that aborts (a redirect, a cancelled subresource) still leaves the
    // page running and still fires the request we are after, so a rejection here
    // is not a reason to stop waiting.
    await win.loadURL(SEARCH_PAGE).catch(() => undefined);
    const deadline = Date.now() + Math.min(timeoutMs, 20_000);
    while (!found && Date.now() < deadline) await sleep(250);
    return found;
  } catch {
    return null;
  } finally {
    part.webRequest.onBeforeRequest({ urls: ['*://*.playstation.com/*'] }, null);
    if (!win.isDestroyed()) win.destroy();
    void part.clearStorageData().catch(() => undefined);
  }
}

module.exports = { discoverPsnHash, hashFromUrl };
