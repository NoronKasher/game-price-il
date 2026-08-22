import type { api as LiveApi } from './api';
import type { SourceRef } from './types';

/**
 * The API the extension build talks to: a service worker, not a server.
 *
 * Same interface as the live client and the demo client — this is the third
 * implementation of it, which is the point. No component knows which one it
 * got, so the same UI runs against a Node server, a recorded snapshot, or an
 * extension worker with no changes at all.
 *
 * Calls go over a long-lived port rather than one-shot sendMessage: an open
 * port counts as activity, so MV3 will not terminate the worker while a
 * sixteen-store fan-out is still running.
 */

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

let port: chrome.runtime.Port | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function connect(): chrome.runtime.Port {
  if (port) return port;
  const p = chrome.runtime.connect({ name: 'vgpt' });
  p.onMessage.addListener((msg: { id: number; result?: unknown; error?: string }) => {
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    pending.delete(msg.id);
    if (msg.error) waiting.reject(new Error(msg.error));
    else waiting.resolve(msg.result);
  });
  p.onDisconnect.addListener(() => {
    port = null;
    // A worker that died mid-flight leaves callers hanging forever otherwise.
    for (const [, waiting] of pending) waiting.reject(new Error('background disconnected'));
    pending.clear();
  });
  port = p;
  return p;
}

function call<T>(method: string, ...args: unknown[]): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    connect().postMessage({ id, method, args });
  });
}

export const api: typeof LiveApi = {
  search: (q, includeDlc = false) => call('search', q, includeDlc),
  offers: (refs: SourceRef[], platform: string) => call('offers', refs, platform),
  meta: (refs: SourceRef[]) => call('meta', refs),

  wishlist: () => call('wishlist'),
  removeWish: async (id: number) => {
    await call('removeWish', id);
    // The caller only checks that it resolved; there is no HTTP here to report.
    return new Response(null, { status: 200 });
  },
  trackDetail: (id: number) => call('trackDetail', id),
  trackStatus: (title: string, platform: string) => call('trackStatus', title, platform),
  track: (item) => call('track', item),
  trackRefresh: (id: number) => call('trackRefresh', id),
  refresh: () => call('refresh'),
  setTrackSetting: (id, patch) => call('setTrackSetting', id, patch),

  getNotifications: () => call('getNotifications'),
  markNotificationsRead: async () => {
    await call('markNotificationsRead');
    return new Response(null, { status: 200 });
  },
  clearNotifications: async () => {
    await call('clearNotifications');
    return new Response(null, { status: 200 });
  },

  getSettings: () => call('getSettings'),
  setSettings: (patch) => call('setSettings', patch),
  importData: (items: unknown) => call('importData', items),

  /**
   * Suggestions are not wired to the worker on purpose.
   *
   * suggest.ts races several store typeaheads on every keystroke. Behind a
   * message port that means waking the worker per character, and the budget it
   * relies on is a server-side assumption. An empty list costs the user an
   * autocomplete, never a search.
   */
  suggest: async () => ({ suggestions: [] }),

  /** Deal ticker and the adapter canary are server-side scheduled jobs. */
  ticker: async () => ({ deals: [] }),
  getHealth: async () => ({ report: null, due: false }),
  runHealth: async () => ({ report: { checkedAt: new Date().toISOString(), adapters: [] } }),

  /** Keys are held in chrome.storage; the settings screen for them is not built yet. */
  getKeys: async () => ({
    ggdeals: { configured: false, source: 'none' as const },
    itad: { configured: false, source: 'none' as const },
  }),
  setKeys: async () => ({
    ggdeals: { configured: false, source: 'none' as const },
    itad: { configured: false, source: 'none' as const },
  }),

  /**
   * PlayStation still searches on the known hash, but cannot yet re-learn a
   * rotated one: recovery drives Playwright on the server. Reported honestly
   * rather than as a working feature.
   */
  getPsnHash: async () => ({ hash: '', source: 'builtin' as const, browser: null }),
  setPsnHash: async (hash: string) => ({ ok: false, hash, source: 'builtin' as const }),
  recoverPsnHash: async () => ({ found: null, hash: '', source: 'builtin' as const }),
};
