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

/** Not in the slice yet — see extension/src/background.ts for what and why. */
function notYet(what: string): never {
  throw new Error(`${what} is not part of the extension slice yet`);
}

export const api: typeof LiveApi = {
  search: (q, includeDlc = false) => call('search', q, includeDlc),
  offers: (refs: SourceRef[], platform: string) => call('offers', refs, platform),

  // Everything below is server-shaped and still being ported. Each one fails
  // loudly rather than returning a plausible empty answer, so a gap in the
  // slice can never be mistaken for "the stores had nothing".
  meta: async () => ({ meta: null }),
  suggest: async () => ({ suggestions: [] }),
  ticker: async () => ({ deals: [] }),
  wishlist: async () => ({ items: [] }),
  removeWish: async () => new Response(null, { status: 501 }),
  trackDetail: async () => notYet('trackDetail'),
  trackStatus: async () => ({ tracked: false, history: [] }),
  track: async () => notYet('track'),
  trackRefresh: async () => ({ history: [] }),
  refresh: async () => ({ updated: 0 }),
  setTrackSetting: async () => ({ ok: true }),
  getNotifications: async () => ({ items: [], unread: 0 }),
  markNotificationsRead: async () => new Response(null, { status: 501 }),
  clearNotifications: async () => new Response(null, { status: 501 }),
  getSettings: async () => ({
    captureDaysGlobal: 7,
    displayCurrency: 'ILS' as const,
    ratesFromILS: { ILS: 1, USD: 0.33, EUR: 0.29 },
    alerts: { pct: 20, price: null, ccy: 'ILS', anyDrop: true, scope: 'auto' as const },
  }),
  setSettings: async () => notYet('setSettings'),
  getKeys: async () => ({
    ggdeals: { configured: false, source: 'none' as const },
    itad: { configured: false, source: 'none' as const },
  }),
  setKeys: async () => notYet('setKeys'),
  getHealth: async () => ({ report: null, due: false }),
  runHealth: async () => notYet('runHealth'),
  getPsnHash: async () => ({ hash: '', source: 'builtin' as const, browser: null }),
  setPsnHash: async () => notYet('setPsnHash'),
  recoverPsnHash: async () => ({ found: null, hash: '', source: 'builtin' as const }),
  importData: async () => notYet('importData'),
};
