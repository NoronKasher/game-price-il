import type { GameHit, Offer, SourceAdapter } from './adapters/types.ts';
import type { Platform } from './search.ts';

/** Which source a game came from, and its id there. */
export interface SourceRef {
  sourceId: string;
  sourceGameId: string;
}

/** Per-source outcome, so the UI can say "this store's data is missing" honestly. */
export interface SourceStatus {
  id: string;
  name: string;
  ok: boolean;
  reason?: 'error' | 'rate_limited';
  count: number;
}
import { RateLimitedError } from './adapters/politeFetch.ts';
import { describeProduct, groupKey } from './normalize.ts';
import { parseQuery } from './search.ts';

/**
 * The fan-out across stores, with no host in sight.
 *
 * This used to live inside the Express route handlers, which quietly made a
 * Node server the only place the tool could run. It is the most valuable code
 * in the project — sixteen stores' worth of behaviour — and none of it needs a
 * server: no filesystem, no database, no `node:` anything, just `fetch` and the
 * adapters. Lifting it out is what lets the same logic run inside a browser
 * extension's service worker without a second, drifting copy.
 *
 * Everything platform-specific (storage, HTTP transport, key files) stays in
 * the shell that calls this.
 */

export const ALL_PLATFORMS: Platform[] = ['pc', 'ps5', 'ps4', 'xbox', 'switch'];

/**
 * A failed source is reported, never thrown: one store being down must not cost
 * the user the other fifteen. Self-imposed rate limiting is called out
 * separately from a real error, because "we chose not to ask" and "the store
 * broke" mean very different things to someone reading the results.
 */
function statusFor(source: SourceAdapter, err: unknown): SourceStatus {
  const rateLimited = err instanceof RateLimitedError;
  if (!rateLimited) console.error(`source ${source.id} failed:`, err);
  return {
    id: source.id,
    name: source.nameHe,
    ok: false,
    reason: rateLimited ? 'rate_limited' : 'error',
    count: 0,
  };
}

export interface SearchResult {
  query: ReturnType<typeof parseQuery>;
  queryKey: string;
  games: GameHit[];
  platformStatus: Record<string, boolean>;
  sources: SourceStatus[];
}

/** Search every applicable source at once and merge what comes back. */
export async function searchGames(
  sources: SourceAdapter[],
  raw: string,
  includeDlc = false
): Promise<SearchResult> {
  const parsed = parseQuery(raw.trim());
  const wanted = parsed.platforms.length ? parsed.platforms : ALL_PLATFORMS;

  const hits: GameHit[] = [];
  const status: SourceStatus[] = [];
  const active = sources.filter((s) => s.enabled && s.platforms.some((p) => wanted.includes(p)));
  await Promise.all(
    active.map(async (s) => {
      try {
        // Stores answer a search for a game with its add-ons too, so a search
        // for Far Cry 6 came back with cards for its Season Pass and credit
        // packs. Filtered centrally: every source has the same problem.
        const found = (await s.search(parsed.title, wanted))
          .map((h) => ({ ...h, dlc: describeProduct(h.title).dlc }))
          .filter((h) => includeDlc || !h.dlc);
        hits.push(...found);
        status.push({ id: s.id, name: s.nameHe, ok: true, count: found.length });
      } catch (err) {
        status.push(statusFor(s, err));
      }
    })
  );

  // Which of the wanted platforms have any active source (for "coming soon" chips).
  const platformStatus = Object.fromEntries(
    wanted.map((p) => [p, sources.some((s) => s.enabled && s.platforms.includes(p))])
  );

  // The grouping key for what was actually typed, so the client never has to
  // reimplement the normalisation and drift from it.
  return { query: parsed, queryKey: groupKey(parsed.title), games: hits, platformStatus, sources: status };
}

/** Steam appID (for description/genre) from a game's refs, if any. */
export function steamAppIdOf(refs: SourceRef[]): string | null {
  return refs.find((r) => r.sourceId === 'steam-regional')?.sourceGameId ?? null;
}

export interface OffersResult {
  offers: Offer[];
  partial: boolean;
  sources: SourceStatus[];
}

/** Every price for one game on one platform, cheapest first. */
export async function offersFor(
  sources: SourceAdapter[],
  refs: SourceRef[],
  platform: Platform
): Promise<OffersResult> {
  const offers: Offer[] = [];
  const status: SourceStatus[] = [];
  await Promise.all(
    refs.map(async (ref) => {
      const source = sources.find((s) => s.id === ref.sourceId);
      if (!source?.enabled) return;
      try {
        const got = await source.getOffers(ref.sourceGameId, platform);
        offers.push(...got);
        status.push({ id: source.id, name: source.nameHe, ok: true, count: got.length });
      } catch (err) {
        status.push(statusFor(source, err));
      }
    })
  );

  // A game's several editions (and the odd source that returns it twice) each
  // price across every region, so the same store+region can arrive many times.
  // Collapse to the cheapest per store+region+kind — each region shows once per
  // store, the actual cheapest way to buy the game there.
  const bestByKey = new Map<string, Offer>();
  for (const o of offers) {
    const key = `${o.store}|${o.region ?? ''}|${o.kind}`;
    const prev = bestByKey.get(key);
    if (!prev || o.priceILS < prev.priceILS) bestByKey.set(key, o);
  }
  const deduped = [...bestByKey.values()].sort((a, b) => a.priceILS - b.priceILS);
  return { offers: deduped, partial: status.some((s) => !s.ok), sources: status };
}
