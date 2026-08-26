import { setPoliteStore } from '../../server/src/adapters/politeFetch.ts';
import { chromeStoragePoliteStore, politeSnapshot } from './politeStorage.ts';
import { makeHandlers, type Handler } from './handlers.ts';
import { setChangeListener } from './db.browser.ts';
import { scheduleSyncPush, startSyncMirror } from './syncMirror.ts';
import { startAutoCapture } from './autoCapture.ts';
import { trackAmazonListing } from './amazonTrack.ts';
import type { SourceAdapter } from '../../server/src/adapters/types.ts';

import { cheapshark } from '../../server/src/adapters/cheapshark.ts';
import { steamRegional } from '../../server/src/adapters/steam.ts';
import { epic } from '../../server/src/adapters/epic.ts';
import { ubisoft } from '../../server/src/adapters/ubisoft.ts';
import { ea } from '../../server/src/adapters/ea.ts';
import { vgs } from '../../server/src/adapters/vgs.ts';
import { player1 } from '../../server/src/adapters/player1.ts';
import { arcadia } from '../../server/src/adapters/arcadia.ts';
import { gamestorm } from '../../server/src/adapters/gamestorm.ts';
import { ivory } from '../../server/src/adapters/ivory.ts';
import { bug } from '../../server/src/adapters/bug.ts';
import { xbox } from '../../server/src/adapters/xbox.ts';
import { nintendo } from '../../server/src/adapters/nintendo.ts';
import { psn } from '../../server/src/adapters/psn.ts';
import { gog } from '../../server/src/adapters/gog.ts';
import { ggdeals } from '../../server/src/adapters/ggdeals.ts';
import { itad } from '../../server/src/adapters/itad.ts';

/**
 * The extension's service worker — the whole "server", inside the browser.
 *
 * Nothing here listens on a port and nothing is installed outside the browser.
 * This is a JavaScript context that Chrome starts on demand, and the store
 * adapters below are imported UNCHANGED from the same files the Node server
 * uses: not one of them touches `node:` anything, so the sixteen stores' worth
 * of behaviour ports for free. What changes is only the shell around it —
 * storage, and how the UI asks for things.
 *
 * All sixteen sources run here. Three needed a browser stand-in rather than a
 * port, each aliased in extension/vite.config.ts:
 *  - keys.ts    → chrome.storage, so GG.deals and ITAD keep their BYOK keys
 *                 without reading a file from disk;
 *  - db.ts      → IndexedDB, so tracking and price history work;
 *  - psnHash.ts → a stub, because recovery drives Playwright. PlayStation still
 *                 searches on the known hash; it just cannot yet re-learn a
 *                 rotated one by itself.
 */
const sources: SourceAdapter[] = [
  cheapshark,
  steamRegional,
  epic,
  ubisoft,
  ea,
  vgs,
  player1,
  arcadia,
  gamestorm,
  ivory,
  bug,
  xbox,
  nintendo,
  psn,
  gog,
  ggdeals,
  itad,
];

// A marker for diagnosing the worker from outside: an MV3 service worker that
// fails to evaluate still leaves an inspectable context behind, so "is my code
// actually running in there?" is otherwise surprisingly hard to answer.
(self as unknown as Record<string, unknown>).__vgpt = { loadedAt: Date.now() };

// Before anything can fetch: point the rate limiter at storage that outlives
// this worker. Registered at module scope so it is in place on every wake-up,
// not just the first one.
setPoliteStore(chromeStoragePoliteStore);

// The tracked list follows the browser account to the user's other machines.
// At module scope for the same reason as the line above: the worker is killed
// and restarted constantly, and this has to be in place on every wake-up.
setChangeListener(scheduleSyncPush);
startSyncMirror();

// Re-price the tracked list on a schedule. Without this the extension only ever
// checked a price when somebody opened the game — which is the one moment they
// did not need to be told.
startAutoCapture(sources);

/**
 * A fan-out takes far longer than MV3's ~30s idle timeout allows.
 *
 * Chrome only counts *inactivity*, and an open message port counts as activity,
 * so the worker stays alive while a request it is serving is still running. The
 * port is opened by the caller and closed when the answer is posted, which
 * means the lifetime is exactly the work — no keep-alive hacks, no polling.
 */
const handlers: Record<string, Handler> = makeHandlers(sources);

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'vgpt') return;
  port.onMessage.addListener(async (msg: { id: number; method: string; args: unknown[]; streaming?: boolean }) => {
    const handler = handlers[msg.method];
    if (!handler) {
      port.postMessage({ id: msg.id, error: `unknown method "${msg.method}"` });
      return;
    }
    try {
      // A streaming caller gets an extra argument: something to report partial
      // answers through. Posting them under the SAME id is what lets the client
      // keep one pending promise while the steps arrive.
      const args = msg.streaming
        ? [...(msg.args ?? []), (progress: unknown) => port.postMessage({ id: msg.id, progress })]
        : (msg.args ?? []);
      const result = await (handler as (...a: unknown[]) => Promise<unknown>)(...args);
      port.postMessage({ id: msg.id, result });
    } catch (err) {
      // Errors must cross the port as data — an Error does not survive
      // structured cloning with its message intact in every browser.
      port.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  });
});

/**
 * The Amazon card asking us to remember a listing.
 *
 * Read from the page the user opened, in their browser, and stored locally —
 * this extension never fetches Amazon itself. See src/amazon.ts for why that
 * line is where it is.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.__vgpt !== 'amazon-track') return;
  // Only from a page we actually injected into. A message claiming to be from
  // Amazon is not the same as one that came from there.
  const from = sender.origin ?? sender.url ?? '';
  if (!/^https:\/\/www\.amazon\./.test(from)) {
    sendResponse({ ok: false, error: 'unexpected sender' });
    return;
  }
  void trackAmazonListing(msg.listing)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'failed' }));
  return true; // keep the channel open for the async reply
});

// Opening the toolbar button opens the app in a tab. A popup is the wrong shape
// for a price board that wants the width.
chrome.action?.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
