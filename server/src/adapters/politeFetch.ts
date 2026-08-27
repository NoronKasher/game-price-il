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

export interface HostState {
  /** UTC day (YYYY-MM-DD) the counter belongs to. */
  day: string;
  count: number;
  /** Epoch ms until which this host is backed off; 0 = clear. */
  pausedUntil: number;
  /** Epoch ms of the last request actually sent to this host. */
  lastAt: number;
}

/**
 * Where the per-host limits live.
 *
 * The default below is process memory, which enforces nothing across a restart —
 * so every shell that matters supplies something that remembers:
 *   - the extension, because MV3 kills its service worker after ~30s idle and an
 *     in-memory counter would reset mid-fan-out (extension/src/politeStorage.ts);
 *   - the server, because the desktop build starts at every login and would
 *     otherwise hand itself a fresh daily budget each boot (../politeStore.ts).
 *
 * Silently scraping harder than promised is the one failure this module exists
 * to prevent, and a counter that forgets is exactly that failure with none of
 * the symptoms: nothing errors, and a shop that asked us to wait an hour is
 * obeyed only until the process next stops.
 */
export interface PoliteStore {
  get(host: string): Promise<HostState | null>;
  set(host: string, state: HostState): Promise<void>;
}

const memory = new Map<string, HostState>();
const memoryStore: PoliteStore = {
  async get(host) {
    return memory.get(host) ?? null;
  },
  async set(host, state) {
    memory.set(host, state);
  },
};

let store: PoliteStore = memoryStore;

/** Swap the limit storage. Both real shells do; only tests run on the memory one. */
export function setPoliteStore(next: PoliteStore): void {
  store = next;
}

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

async function getState(host: string): Promise<HostState> {
  const now = today();
  const saved = await store.get(host);
  if (saved && saved.day === now) return saved;
  // A new day resets the request count, but NOT the back-off or the last-request
  // time: a store that asked us to stand down at 23:59 is still standing us down
  // at 00:01, and midnight is not permission to skip the spacing.
  return { day: now, count: 0, pausedUntil: saved?.pausedUntil ?? 0, lastAt: saved?.lastAt ?? 0 };
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

/** How many hops a store may bounce us through before we give up. */
const MAX_REDIRECTS = 5;

/**
 * Follow redirects OURSELVES, checking every hop against the allowlist.
 *
 * `redirect: 'follow'` walked straight around the SSRF guard. The guard checks
 * the URL we ask for; fetch then silently follows wherever the answer points,
 * and the final request is the one that actually happens. A store that is
 * compromised — or simply one whose open-redirect endpoint somebody found —
 * could answer with `Location: http://127.0.0.1:6379/` or the cloud metadata
 * address, and this server would dutifully fetch it. Those are the exact two
 * targets net.ts names as the reason the allowlist exists.
 *
 * So: manual redirects, every hop re-validated, and a cap so a redirect loop
 * ends in an error rather than a hang.
 */
async function followChecked(startUrl: string): Promise<Response> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 3xx with a Location is the only thing we follow; a 304 or a bodyless 3xx
    // is handed back as-is for the caller to deal with.
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return res;

    const next = new URL(location, url).href;
    if (!isAllowedScrapeUrl(next)) {
      throw new Error(`politeFetch: refusing to follow redirect to disallowed URL "${next}"`);
    }
    url = next;
  }
  throw new Error(`politeFetch: too many redirects from "${startUrl}"`);
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

  // Hoisted so `finally` can record the request time and any back-off, whether
  // this call succeeded, failed, or threw before sending anything.
  let st: HostState | null = null;
  let sent = false;
  try {
    // Budget and back-off are checked HERE, inside the per-host critical section,
    // not before queueing. Requests wait their turn for minutes, so a check made
    // on the way in is long stale by the time it runs: a whole fan-out could pass
    // the gate together, then keep hammering a store that has since answered 429
    // — exactly the standing-down this module exists to guarantee. Re-reading the
    // state (and incrementing the counter) under the lock makes both limits real.
    st = await getState(host);
    if (st.pausedUntil > Date.now()) {
      throw new RateLimitedError(host, 'backoff', st.pausedUntil - Date.now());
    }
    if (st.count >= DAILY_BUDGET) {
      throw new RateLimitedError(host, 'budget', msUntilTomorrow());
    }
    // Spacing is enforced from the RECORDED time of the last request, not from
    // the in-memory queue alone. The queue is gone after a service-worker
    // restart, and without this a fresh worker would fire at a host it spoke to
    // 200ms ago.
    const since = Date.now() - st.lastAt;
    if (st.lastAt && since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);

    // Another queued call may have populated the cache while we waited.
    const fresh = cache.get(url);
    if (fresh && Date.now() - fresh.at < CACHE_TTL_MS) return fresh.body;

    st.count++;
    st.lastAt = Date.now();
    // Written BEFORE the request, not after: a worker killed mid-flight must
    // still remember that the request happened.
    await store.set(host, st);
    sent = true;
    const res = await followChecked(url);
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
    // Record the request time from when this call FINISHED, so the next one is
    // spaced from the end of the last conversation rather than its start — a
    // 20s request must not be followed instantly. Persisting here also captures
    // a `pausedUntil` set by the 429/503/403 branch above.
    // Only when something was actually sent: a cache hit or a self-imposed
    // refusal is not a conversation with the store, and must not push the clock.
    if (st && sent) {
      st.lastAt = Date.now();
      await store.set(host, st).catch(() => undefined);
    }
    release();
  }
}

function msUntilTomorrow(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}
