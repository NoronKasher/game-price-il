import { setPoliteStore } from '../../server/src/adapters/politeFetch.ts';
import { chromeStoragePoliteStore, politeSnapshot } from './politeStorage.ts';
import { searchGames, offersFor } from '../../server/src/fanout.ts';
import type { SourceRef } from '../../server/src/fanout.ts';
import type { Platform } from '../../server/src/search.ts';
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
 * Sources deliberately absent from this slice:
 *  - GG.deals and ITAD read a key from the filesystem (keys.ts). They need a
 *    chrome.storage-backed BYOK path first.
 *  - PlayStation pulls in psnHash.ts, which drives Playwright. In an extension
 *    that whole mechanism is replaced by watching a request, which is simpler —
 *    but it is a rewrite, not a move, so it is not in the slice.
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
];

// A marker for diagnosing the worker from outside: an MV3 service worker that
// fails to evaluate still leaves an inspectable context behind, so "is my code
// actually running in there?" is otherwise surprisingly hard to answer.
(self as unknown as Record<string, unknown>).__vgpt = { loadedAt: Date.now() };

// Before anything can fetch: point the rate limiter at storage that outlives
// this worker. Registered at module scope so it is in place on every wake-up,
// not just the first one.
setPoliteStore(chromeStoragePoliteStore);

/**
 * A fan-out takes far longer than MV3's ~30s idle timeout allows.
 *
 * Chrome only counts *inactivity*, and an open message port counts as activity,
 * so the worker stays alive while a request it is serving is still running. The
 * port is opened by the caller and closed when the answer is posted, which
 * means the lifetime is exactly the work — no keep-alive hacks, no polling.
 */
type Handler = (...args: never[]) => Promise<unknown>;

const handlers: Record<string, Handler> = {
  async search(q: string, includeDlc = false) {
    return searchGames(sources, q, includeDlc);
  },

  async offers(refs: SourceRef[], platform: Platform) {
    return offersFor(sources, refs, platform);
  },

  /** What the limiter currently owes each store — proof the state is real. */
  async politeState() {
    return politeSnapshot();
  },

  async sources() {
    return sources.map((s) => ({ id: s.id, name: s.nameHe, platforms: s.platforms }));
  },
} as unknown as Record<string, Handler>;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'vgpt') return;
  port.onMessage.addListener(async (msg: { id: number; method: string; args: unknown[] }) => {
    const handler = handlers[msg.method];
    if (!handler) {
      port.postMessage({ id: msg.id, error: `unknown method "${msg.method}"` });
      return;
    }
    try {
      const result = await (handler as (...a: unknown[]) => Promise<unknown>)(...(msg.args ?? []));
      port.postMessage({ id: msg.id, result });
    } catch (err) {
      // Errors must cross the port as data — an Error does not survive
      // structured cloning with its message intact in every browser.
      port.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  });
});

// Opening the toolbar button opens the app in a tab. A popup is the wrong shape
// for a price board that wants the width.
chrome.action?.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
