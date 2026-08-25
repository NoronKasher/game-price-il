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

/**
 * Told about each source the moment it lands, rather than at the end.
 *
 * The fan-out cannot go faster than its slowest store — and the slowest stores
 * are the Israeli ones this tool exists for, held to a 2.5s gap we are not going
 * to shorten. What CAN change is making the user wait for it: CheapShark answers
 * in ~370ms with most of the catalogue, and there is no reason to sit on that for
 * four more seconds while Ivory finishes.
 *
 * `games` carries only what THIS source found, not the running total — the
 * caller accumulates. Re-sending every hit on every step would grow quadratically
 * over a stream for no benefit.
 */
export interface SearchProgress {
  /** How many sources will be asked. Known before any of them answer. */
  total: number;
  /** How many have now answered, successfully or not. */
  done: number;
  status: SourceStatus;
  games: GameHit[];
}

/** Search every applicable source at once and merge what comes back. */
export async function searchGames(
  sources: SourceAdapter[],
  raw: string,
  includeDlc = false,
  onProgress?: (p: SearchProgress) => void
): Promise<SearchResult> {
  const parsed = parseQuery(raw.trim());
  const wanted = parsed.platforms.length ? parsed.platforms : ALL_PLATFORMS;

  const hits: GameHit[] = [];
  const status: SourceStatus[] = [];
  const active = sources.filter((s) => s.enabled && s.platforms.some((p) => wanted.includes(p)));
  let done = 0;
  await Promise.all(
    active.map(async (s) => {
      let found: GameHit[] = [];
      let outcome: SourceStatus;
      try {
        // Stores answer a search for a game with its add-ons too, so a search
        // for Far Cry 6 came back with cards for its Season Pass and credit
        // packs. Filtered centrally: every source has the same problem.
        found = (await s.search(parsed.title, wanted))
          .map((h) => ({ ...h, dlc: describeProduct(h.title).dlc }))
          .filter((h) => includeDlc || !h.dlc);
        hits.push(...found);
        outcome = { id: s.id, name: s.nameHe, ok: true, count: found.length };
      } catch (err) {
        outcome = statusFor(s, err);
      }
      status.push(outcome);
      // After the status is recorded, so a listener always sees a consistent
      // count — and never inside the try, where a throwing listener would be
      // reported as the source failing.
      done++;
      try {
        onProgress?.({ total: active.length, done, status: outcome, games: found });
      } catch (err) {
        console.error('search progress listener failed:', err);
      }
    })
  );

  // Returns the renames so the exact-match key can follow them: someone who
  // typed "jedi fallen order" still gets that game opened, even though its group
  // is now filed under the fuller "star wars jedi fallen order".
  const renamed = mergeTruncatedTitles(hits);
  const typedKey = groupKey(parsed.title);
  const canonicalKey = renamed.get(typedKey) ?? typedKey;

  // Which of the wanted platforms have any active source (for "coming soon" chips).
  const platformStatus = Object.fromEntries(
    wanted.map((p) => [p, sources.some((s) => s.enabled && s.platforms.includes(p))])
  );

  // The grouping key for what was actually typed, so the client never has to
  // reimplement the normalisation and drift from it.
  return { query: parsed, queryKey: canonicalKey, games: hits, platformStatus, sources: status };
}

/**
 * Merge groups where one store gave a shorter version of the same title.
 *
 * EA calls it "Jedi Fallen Order"; everyone else calls it "Star Wars Jedi Fallen
 * Order". Different group keys, so the same game arrived as two cards — and with
 * the DLC filter off, the search for it showed three.
 *
 * The rule is SUFFIX, not substring, and that distinction is the whole safety of
 * it. Franchise names are prepended ("Star Wars …", "The Witcher …") while
 * sequels are appended ("Hades" → "Hades II"), so:
 *
 *   "star wars jedi fallen order".endsWith("jedi fallen order")  → merge ✓
 *   "hades ii".endsWith("hades")                                 → false, kept apart ✓
 *
 * Two guards against over-merging: the shorter key must be at least two words —
 * so a game named "Rally" is never absorbed into "Dirt Rally" — and the match
 * must fall on a word boundary, so "…lands" never swallows "…ands".
 */
function mergeTruncatedTitles(hits: GameHit[]): Map<string, string> {
  const keys = [...new Set(hits.map((h) => h.groupKey))];
  // Longest first: a short key should collapse into the fullest title available,
  // not into a middling one that would then collapse again.
  const byLength = keys.slice().sort((a, b) => b.length - a.length);

  const canonical = new Map<string, string>();
  for (const short of keys) {
    if (short.split(' ').length < 2) continue;
    for (const long of byLength) {
      if (long === short || long.length <= short.length) continue;
      if (long.endsWith(short) && long[long.length - short.length - 1] === ' ') {
        canonical.set(short, long);
        break;
      }
    }
  }
  for (const hit of hits) {
    const target = canonical.get(hit.groupKey);
    if (target) hit.groupKey = target;
  }
  return canonical;
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
export interface OffersProgress {
  total: number;
  done: number;
  status: SourceStatus;
  offers: Offer[];
}

export async function offersFor(
  sources: SourceAdapter[],
  refs: SourceRef[],
  platform: Platform,
  onProgress?: (p: OffersProgress) => void
): Promise<OffersResult> {
  const offers: Offer[] = [];
  const status: SourceStatus[] = [];
  // Refs naming a source we do not have (or one switched off) are skipped, so
  // the total has to be the count that will actually be ASKED — otherwise a bar
  // built from it stalls short of the end forever.
  const askable = refs.filter((ref) => sources.find((s) => s.id === ref.sourceId)?.enabled);
  let done = 0;
  await Promise.all(
    askable.map(async (ref) => {
      const source = sources.find((s) => s.id === ref.sourceId)!;
      let got: Offer[] = [];
      let outcome: SourceStatus;
      try {
        got = await source.getOffers(ref.sourceGameId, platform);
        offers.push(...got);
        outcome = { id: source.id, name: source.nameHe, ok: true, count: got.length };
      } catch (err) {
        outcome = statusFor(source, err);
      }
      status.push(outcome);
      done++;
      try {
        onProgress?.({ total: askable.length, done, status: outcome, offers: got });
      } catch (err) {
        console.error('offers progress listener failed:', err);
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
