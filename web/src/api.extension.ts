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
  /** Set for streaming calls; each partial answer is handed straight over. */
  onProgress?: (p: unknown) => void;
}

let port: chrome.runtime.Port | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function connect(): chrome.runtime.Port {
  if (port) return port;
  const p = chrome.runtime.connect({ name: 'vgpt' });
  p.onMessage.addListener((msg: { id: number; result?: unknown; error?: string; progress?: unknown }) => {
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    // A progress message is one step of an answer, not the answer: the call
    // stays pending, which also keeps the port — and so the worker — alive.
    if (msg.progress !== undefined) {
      waiting.onProgress?.(msg.progress);
      return;
    }
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

/** Like `call`, but partial answers arrive on the way. */
function callStreaming<T>(
  method: string,
  onProgress: (p: unknown) => void,
  ...args: unknown[]
): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    connect().postMessage({ id, method, args, streaming: true });
  });
}

export const api: typeof LiveApi = {
  search: (q, includeDlc = false) => call('search', q, includeDlc),
  searchStream: (q, includeDlc, onProgress) =>
    callStreaming('search', (p) => onProgress(p as import('./types').SearchProgress), q, includeDlc),
  offers: (refs: SourceRef[], platform: string) => call('offers', refs, platform),
  offersStream: (refs: SourceRef[], platform: string, onProgress) =>
    callStreaming('offers', (p) => onProgress(p as import('./types').OffersProgress), refs, platform),
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
  getNotificationLog: () => call('getNotificationLog'),
  purgeNotifications: async () => {
    await call('purgeNotifications');
  },
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
  notifyGamePass: async (title: string, platform: string, subscriptions: string[]) => {
    await call('notifyGamePass', title, platform, subscriptions);
  },
  refreshUnchecked: (onProgress) =>
    callStreaming('refreshUnchecked', (p) => onProgress(p as import('./types').FirstCheckProgress)),
  exportToken: (withHistory: boolean, prefs: Record<string, string>) => call('exportToken', withHistory, prefs),
  importToken: (token: string) => call('importToken', token),
  // Streamed through the same port as search and prices: the import is minutes
  // long and the worker must stay awake for it (an open port counts as
  // activity, which is exactly why the port shape is used here).
  importSteam: (profile: string, onProgress) =>
    callStreaming('importSteam', (p) => onProgress(p as import('./types').SteamImportProgress), profile),

  /**
   * Suggestions are not wired to the worker on purpose.
   *
   * suggest.ts races several store typeaheads on every keystroke. Behind a
   * message port that means waking the worker per character, and the budget it
   * relies on is a server-side assumption. An empty list costs the user an
   * autocomplete, never a search.
   */
  suggest: async () => ({ suggestions: [] }),

  ticker: (limit?: number) => call('ticker', limit),
  deals: (page: number, limit: number) => call('deals', page, limit),
  bundles: (appId: string) => call('bundles', appId),
  diagnostics: (q?: string) => call('diagnostics', q),

  /**
   * The canary reads its stored report for free; RUNNING one is sixteen real
   * probe searches, so it stays a button here rather than the scheduled job it
   * is on the server. One server running a daily canary is one server's worth of
   * requests; every user's browser doing the same would multiply it by the
   * userbase, which is not a bargain the stores agreed to.
   */
  getHealth: () => call('getHealth'),
  runHealth: () => call('runHealth'),

  /** Bring-your-own-key for GG.deals and ITAD, held in chrome.storage. */
  getKeys: () => call('getKeys'),
  setKeys: (patch: { ggdeals?: string; itad?: string }) => call('setKeys', patch),

  /**
   * PlayStation's hash can be read and pasted here exactly as on the server.
   * What is still missing is the automatic recovery: it means running the
   * store's own page and reading the request it makes — the desktop build does
   * that with its own Chromium, and an extension cannot without permission to
   * observe requests it has no other reason to see.
   */
  getPsnHash: () => call('getPsnHash'),
  setPsnHash: (hash: string) => call('setPsnHash', hash),
  recoverPsnHash: async () => ({ found: null, hash: '', source: 'builtin' as const }),
};
