/**
 * Network safety — the single list of hosts this tool is ever allowed to fetch,
 * and the guard that enforces it.
 *
 * Why this exists: product URLs are fetched server-side (each store adapter's
 * getOffers does `politeFetch(sourceGameId)`), and some of those URLs arrive
 * from user-shared import files. Without a guard, a hostile file could plant a
 * URL like http://169.254.169.254/ (cloud metadata) or http://127.0.0.1:6379/
 * and turn our server into an SSRF proxy against internal networks. We only ever
 * scrape a handful of known Israeli stores, so an exact-host allowlist closes
 * that door completely while costing us nothing.
 */

/** Every host the scraper legitimately contacts (apex + www for each store). */
export const ALLOWED_SCRAPE_HOSTS = new Set<string>([
  'arcadia.co.il',
  'www.arcadia.co.il',
  'gamestorm.co.il',
  'www.gamestorm.co.il',
  'vgs.co.il',
  'www.vgs.co.il',
  'player1.co.il',
  'www.player1.co.il',
  'ivory.co.il',
  'www.ivory.co.il',
  'bug.co.il',
  'www.bug.co.il',
]);

/**
 * True only for an http(s) URL whose host is one we deliberately scrape.
 * Rejects other hosts, private IPs, and non-http schemes (javascript:, file:,
 * data:, gopher:…) — the whole SSRF/scheme-smuggling class in one check.
 */
export function isAllowedScrapeUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return ALLOWED_SCRAPE_HOSTS.has(parsed.host);
}

/**
 * Resolve a scraped `href` against its store's base URL. Store markup mixes
 * absolute links, root-relative ("/product/1") and bare-relative ("product/1")
 * hrefs; naive `BASE + href` silently welds the last form onto the host
 * ("https://www.bug.co.ilproduct/1"), producing a sourceGameId that 404s on
 * every later wishlist refresh. Every scraping adapter shares this one helper.
 */
export function absoluteUrl(base: string, href: string): string {
  try {
    return new URL(href, base.endsWith('/') ? base : base + '/').href;
  } catch {
    return href;
  }
}

/**
 * True when a request's Origin is same-machine (or absent) — the CSRF gate for
 * state-changing routes. The API has no auth and binds to localhost, so a
 * malicious page the user visits must not be able to POST/DELETE to it. Our own
 * app (same host, any port) and non-browser clients (curl, server-side, which
 * send no Origin) pass; a cross-site Origin is rejected.
 */
export function isLocalOrigin(origin: string | undefined | null): boolean {
  if (!origin) return true; // no Origin: same-origin request, curl, or server-side
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * Where the API server listens.
 *
 * `PORT` alone is NOT a safe signal. Dev harnesses and IDE run-configs export
 * PORT for the *web* dev server, and this API inheriting it moved it off 5174 —
 * the port the Vite proxy talks to — so every request in the app failed with
 * ECONNREFUSED and the UI looked like it had lost all its data. Only a real
 * deployment (NODE_ENV=production, which is what hosts set) may take its port
 * from the environment, and only a deployment binds a public interface.
 * `VGPT_PORT` stays as an explicit local override for both.
 */
export function resolveListenConfig(env: NodeJS.ProcessEnv = process.env): {
  port: number;
  host: string;
  production: boolean;
} {
  const production = env.NODE_ENV === 'production';
  const explicit = Number(env.VGPT_PORT);
  const fromPlatform = production ? Number(env.PORT) : NaN;
  const port =
    (Number.isFinite(explicit) && explicit > 0 && explicit) ||
    (Number.isFinite(fromPlatform) && fromPlatform > 0 && fromPlatform) ||
    5174;
  // Local-first by default: loopback only, never reachable from the LAN.
  const host = env.HOST ?? (production ? '0.0.0.0' : '127.0.0.1');
  return { port, host, production };
}

/**
 * The full CSRF decision, deployment-aware: a state-changing request is allowed
 * when its Origin is local (dev: the Vite app on another localhost port) OR
 * exactly the host the request itself was addressed to (production: the server
 * serves the app, so the app's Origin host:port === the Host header). A page on
 * any other site keeps getting 403 — evil.com can never match the Host header
 * of a request the browser sent to our server.
 */
export function isAllowedRequestOrigin(
  origin: string | undefined | null,
  requestHost: string | undefined
): boolean {
  if (isLocalOrigin(origin)) return true;
  if (!origin || !requestHost) return false;
  try {
    return new URL(origin).host === requestHost; // host includes the port when present
  } catch {
    return false;
  }
}
