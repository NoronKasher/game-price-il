/**
 * Polite HTTP fetching for store scraping — the tool's whole scraping ethic
 * lives here:
 *  - honest User-Agent identifying the tool
 *  - per-host serialization with a minimum delay between requests
 *  - short-lived response cache so repeat searches don't re-hit the store
 *  - request timeout
 *  - a hard daily request budget per host, and automatic back-off when a
 *    store signals overload (HTTP 429 / 503) — so we voluntarily stand down
 *    long before a store would ever need to block us.
 * A wishlist tool needs a handful of requests a day; this keeps us a normal
 * visitor, never a bot to block.
 */

import { isAllowedScrapeUrl } from '../net.ts';

const USER_AGENT = 'GamePriceIL/0.1 (personal wishlist price tracker for Israel)';
const MIN_INTERVAL_MS = 2500;
const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 20_000;
/** Hard ceiling of live requests per host per day — a normal shopper's volume. */
const DAILY_BUDGET = 200;
/** How long to stand down after a store signals overload. */
const BACKOFF_MS = 3 * 60 * 60 * 1000;

const lastRequest = new Map<string, Promise<void>>();
const cache = new Map<string, { body: string; at: number }>();
/** Cap on cached pages. Entries hold whole HTML bodies, so an uncapped map on a
 *  long-running server (auto-capture every 6h across six stores) grows forever. */
const MAX_CACHE_ENTRIES = 300;

/** Drop expired entries, then the oldest ones if we're still over the cap. */
function pruneCache(): void {
  const now = Date.now();
  for (const [url, entry] of cache) {
    if (now - entry.at >= CACHE_TTL_MS) cache.delete(url);
  }
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  for (const [url] of [...cache].sort((a, b) => a[1].at - b[1].at).slice(0, cache.size - MAX_CACHE_ENTRIES)) {
    cache.delete(url);
  }
}

interface HostState {
  /** UTC day (YYYY-MM-DD) the counter belongs to. */
  day: string;
  count: number;
  /** Epoch ms until which this host is backed off; 0 = clear. */
  pausedUntil: number;
}
const hostState = new Map<string, HostState>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

/** Raised when we decline to make a request ourselves (budget/back-off), distinct from a network error. */
export class RateLimitedError extends Error {
  // Explicit fields, not constructor parameter properties: parameter properties
  // are non-erasable TS syntax, and production runs this file with plain
  // `node` (type stripping only) — see the `start` script.
  readonly host: string;
  readonly reason: 'budget' | 'backoff';
  readonly retryAfterMs: number;

  constructor(host: string, reason: 'budget' | 'backoff', retryAfterMs: number) {
    super(`${host}: self-limited (${reason})`);
    this.name = 'RateLimitedError';
    this.host = host;
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

function getState(host: string): HostState {
  const now = today();
  let st = hostState.get(host);
  if (!st || st.day !== now) {
    st = { day: now, count: 0, pausedUntil: st?.pausedUntil ?? 0 };
    hostState.set(host, st);
  }
  return st;
}

/**
 * Israeli stores still serve legacy encodings (Player1 is windows-1255);
 * decode by the declared charset instead of assuming UTF-8.
 */
function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
  let charset = contentType?.match(/charset=([\w-]+)/i)?.[1];
  if (!charset) {
    const head = new TextDecoder('latin1').decode(buf.slice(0, 2048));
    charset = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** Fetch a URL politely; returns the response body as text. */
export async function politeFetch(url: string): Promise<string> {
  // SSRF guard first — before cache or anything else. Product URLs are fetched
  // here, and some come from user-shared import files; only ever touch the
  // stores we deliberately scrape. See net.ts.
  if (!isAllowedScrapeUrl(url)) {
    throw new Error(`politeFetch: refusing to fetch disallowed URL "${url}"`);
  }

  const cached = cache.get(url);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.body;

  const host = new URL(url).host;

  // Chain onto the previous request for this host so calls never overlap
  // and are spaced by MIN_INTERVAL_MS.
  const previous = lastRequest.get(host) ?? Promise.resolve();
  let release!: () => void;
  lastRequest.set(host, new Promise<void>((r) => (release = r)));
  await previous;

  try {
    // Budget and back-off are checked HERE, inside the per-host critical section,
    // not before queueing. Requests wait their turn for minutes, so a check made
    // on the way in is long stale by the time it runs: a whole fan-out could pass
    // the gate together, then keep hammering a store that has since answered 429
    // — exactly the standing-down this module exists to guarantee. Re-reading the
    // state (and incrementing the counter) under the lock makes both limits real.
    const st = getState(host);
    if (st.pausedUntil > Date.now()) {
      throw new RateLimitedError(host, 'backoff', st.pausedUntil - Date.now());
    }
    if (st.count >= DAILY_BUDGET) {
      throw new RateLimitedError(host, 'budget', msUntilTomorrow());
    }
    // Another queued call may have populated the cache while we waited.
    const fresh = cache.get(url);
    if (fresh && Date.now() - fresh.at < CACHE_TTL_MS) return fresh.body;

    st.count++;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429 || res.status === 503 || res.status === 403) {
      // The store is asking us to slow down — honour it: pause this host.
      //
      // 403 counts. Stores in front of a WAF (Ivory, and CheapShark's API) answer
      // a burst with 403 rather than 429, and treating that as an ordinary error
      // meant we kept requesting at full rate against a host that had just told
      // us to stop — the opposite of this module's whole point. Whether the 403
      // is throttling or an outright block, standing down is the right response.
      const retryHeader = Number(res.headers.get('retry-after'));
      const pauseMs = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader * 1000 : BACKOFF_MS;
      st.pausedUntil = Date.now() + pauseMs;
      throw new RateLimitedError(host, 'backoff', pauseMs);
    }
    if (!res.ok) throw new Error(`${host} responded ${res.status}`);
    const body = decodeBody(await res.arrayBuffer(), res.headers.get('content-type'));
    cache.set(url, { body, at: Date.now() });
    pruneCache();
    return body;
  } finally {
    sleep(MIN_INTERVAL_MS).then(release);
  }
}

function msUntilTomorrow(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}
