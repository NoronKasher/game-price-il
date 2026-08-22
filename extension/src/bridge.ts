/**
 * Makes the public demo real — but only for people who installed the extension.
 *
 * The demo runs on GitHub Pages, which serves files and nothing else, so it
 * shows a recorded snapshot. It cannot do better on its own: a web page may only
 * fetch a store that opts in with CORS headers, and the stores that matter here
 * do not. CheapShark answers a page; Steam, VGS and Ivory refuse it. That is the
 * browser's same-origin policy, and the only ways around it are a proxy server
 * (which would mean hosting, and routing strangers' scraping through us) or an
 * extension, which has host permissions and does not need anyone's permission
 * to be honest about who it is.
 *
 * So this content script runs ONLY on the demo's own address, announces itself,
 * and relays price lookups to the service worker. With it installed the demo
 * stops being a recording and shows today's prices; without it, nothing changes.
 *
 * Deliberately limited to READ-ONLY price lookups. The worker can also list and
 * modify the user's tracked games, and a web page — even ours — has no business
 * reaching that. A page that was ever compromised could otherwise read someone's
 * wishlist or write to their history; searching for prices is the whole job here
 * and costs nothing if abused.
 */

const ALLOWED_METHODS = new Set(['search', 'offers', 'meta', 'sources']);

interface Request {
  __vgpt: 'req';
  id: number;
  method: string;
  args: unknown[];
}

function isRequest(data: unknown): data is Request {
  const d = data as Partial<Request> | null;
  return Boolean(d && d.__vgpt === 'req' && typeof d.id === 'number' && typeof d.method === 'string');
}

/** Announce the extension so the page can offer live prices instead of the snapshot. */
document.documentElement.dataset.vgptExtension = chrome.runtime.getManifest().version;

window.addEventListener('message', (event) => {
  // Only this page's own scripts; never another frame talking in.
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (!isRequest(event.data)) return;

  const { id, method, args } = event.data;
  const reply = (payload: Record<string, unknown>) =>
    window.postMessage({ __vgpt: 'res', id, ...payload }, window.location.origin);

  if (!ALLOWED_METHODS.has(method)) {
    reply({ error: `"${method}" is not available to the page` });
    return;
  }

  // A long-lived port, same as the extension's own UI uses: an open port counts
  // as activity, so the worker is not killed midway through a fan-out.
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connect({ name: 'vgpt' });
  } catch {
    reply({ error: 'extension unavailable' });
    return;
  }
  port.onMessage.addListener((msg: { result?: unknown; error?: string }) => {
    reply(msg.error ? { error: msg.error } : { result: msg.result });
    port.disconnect();
  });
  port.onDisconnect.addListener(() => reply({ error: 'extension disconnected' }));
  port.postMessage({ id, method, args: args ?? [] });
});
