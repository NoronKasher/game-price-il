import type { GameHit, HistoryLow, Inclusion, Offer, SourceAdapter } from './adapters/types.ts';
import { asOffers, inclusionsOf, lowsOf } from './adapters/types.ts';
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
import { toLatinQuery } from './hebrewTitles.ts';

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
  /**
   * Present only when a Hebrew query was rewritten before being sent to the
   * stores. The UI is expected to show it: silently searching for something
   * other than what somebody typed is how a tool loses their trust the first
   * time it guesses wrong.
   */
  searchedAs?: { original: string; query: string; dropped: string[] };
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

  // Hebrew in, English out. Every store's catalogue is English, so a Hebrew
  // title reaches all sixteen of them and comes back empty — see hebrewTitles.ts
  // for why this is a dictionary and not a transliterator. Platform words were
  // already taken out above, so only the title itself is translated.
  const hebrew = toLatinQuery(parsed.title);
  const searchTitle = hebrew && hebrew.query ? hebrew.query : parsed.title;
  const searchedAs =
    hebrew && hebrew.query && hebrew.query !== parsed.title
      ? { original: parsed.title, query: hebrew.query, dropped: hebrew.dropped }
      : undefined;

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
        // The source's OWN classification is kept when it has one: a store that
        // says a product is an add-on knows better than our reading of its name.
        found = (await s.search(searchTitle, wanted)).map((h) => ({
          ...h,
          dlc: h.dlc || describeProduct(h.title).dlc,
        }));
        hits.push(...found);
        found = found.filter((h) => includeDlc || !h.dlc);
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
  // Believe any source that recognised an add-on, across all of them, and only
  // then decide what to hide. Doing this before the merge would miss groups that
  // are about to be renamed into one another.
  markKnownAddOns(hits);
  const renamed = mergeTruncatedTitles(hits);
  // Keyed on what was SEARCHED, not what was typed: a Hebrew query's grouping
  // key would match none of the English titles that came back.
  const typedKey = groupKey(searchTitle);
  const canonicalKey = renamed.get(typedKey) ?? typedKey;

  const visible = includeDlc ? hits : hits.filter((h) => !h.dlc);

  // Which of the wanted platforms have any active source (for "coming soon" chips).
  const platformStatus = Object.fromEntries(
    wanted.map((p) => [p, sources.some((s) => s.enabled && s.platforms.includes(p))])
  );

  // The grouping key for what was actually typed, so the client never has to
  // reimplement the normalisation and drift from it.
  return { query: parsed, queryKey: canonicalKey, games: visible, platformStatus, sources: status, searchedAs };
}

/**
 * Let one store's knowledge cover for the others.
 *
 * Some add-ons have no textual tell at all. "Cyberpunk 2077: Phantom Liberty"
 * looks exactly like a sequel subtitle — the module doc in normalize.ts says as
 * much, and warns that guessing from the name would swallow every sequel.
 *
 * But we are not limited to the name. GOG returns productType "dlc" for it;
 * PlayStation and CheapShark sell the same product as an ordinary listing. So
 * rather than invent a rule, the flag is shared: a group that ANY source
 * classified as an add-on is an add-on everywhere. One store's metadata fixes
 * the stores that have none, and this gets better as sources are added rather
 * than needing a list of known expansions that nobody will maintain.
 *
 * Only ever turns the flag ON. A source that omits it is silent, not a vote
 * against — plenty of them have no notion of add-ons to report.
 */
function markKnownAddOns(hits: GameHit[]): void {
  const addOnKeys = new Set<string>();
  for (const h of hits) if (h.dlc) addOnKeys.add(h.groupKey);
  if (addOnKeys.size === 0) return;
  for (const h of hits) if (addOnKeys.has(h.groupKey)) h.dlc = true;
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
  /**
   * What the trackers have on record for this game, widest window first. Not a
   * price you can buy at — a price somebody once could, which is the only way
   * to tell a real discount from a sticker.
   */
  lows?: HistoryLow[];
  /**
   * Subscriptions whose catalogue already carries this game. Not a price and
   * never sorted among them — the point is that this buyer may not need one.
   */
  includedIn?: Inclusion[];
}

/** Every price for one game on one platform, cheapest first. */
export interface OffersProgress {
  total: number;
  done: number;
  status: SourceStatus;
  offers: Offer[];
  /** Carried on the step that produced them, so the summary fills in mid-stream. */
  lows?: HistoryLow[];
  includedIn?: Inclusion[];
}

/**
 * One low per window, the lowest when several trackers disagree.
 *
 * Only one source reports lows today, but taking the minimum is the answer that
 * stays correct when a second one starts: the lowest a game has EVER been is
 * the lowest anybody saw, not the lowest the last responder happened to see.
 */
/** One badge per subscription, however many sources happen to report it. */
function dedupeInclusions(all: Inclusion[]): Inclusion[] {
  const byId = new Map<string, Inclusion>();
  for (const inc of all) if (!byId.has(inc.id)) byId.set(inc.id, inc);
  return [...byId.values()];
}

export function bestLows(all: HistoryLow[]): HistoryLow[] {
  const byWindow = new Map<string, HistoryLow>();
  for (const low of all) {
    const prev = byWindow.get(low.window);
    if (!prev || low.priceILS < prev.priceILS) byWindow.set(low.window, low);
  }
  const order: HistoryLow['window'][] = ['all', 'y1', 'm3'];
  return order.map((w) => byWindow.get(w)).filter((l): l is HistoryLow => l !== undefined);
}

export async function offersFor(
  sources: SourceAdapter[],
  refs: SourceRef[],
  platform: Platform,
  onProgress?: (p: OffersProgress) => void
): Promise<OffersResult> {
  const offers: Offer[] = [];
  const status: SourceStatus[] = [];
  const lows: HistoryLow[] = [];
  const includedIn: Inclusion[] = [];
  // Refs naming a source we do not have (or one switched off) are skipped, so
  // the total has to be the count that will actually be ASKED — otherwise a bar
  // built from it stalls short of the end forever.
  const askable = refs.filter((ref) => sources.find((s) => s.id === ref.sourceId)?.enabled);
  let done = 0;
  await Promise.all(
    askable.map(async (ref) => {
      const source = sources.find((s) => s.id === ref.sourceId)!;
      let got: Offer[] = [];
      let gotLows: HistoryLow[] = [];
      let gotIncluded: Inclusion[] = [];
      let outcome: SourceStatus;
      try {
        const raw = await source.getOffers(ref.sourceGameId, platform);
        got = asOffers(raw);
        gotLows = lowsOf(raw);
        gotIncluded = inclusionsOf(raw);
        offers.push(...got);
        lows.push(...gotLows);
        includedIn.push(...gotIncluded);
        outcome = { id: source.id, name: source.nameHe, ok: true, count: got.length };
      } catch (err) {
        outcome = statusFor(source, err);
      }
      status.push(outcome);
      done++;
      try {
        onProgress?.({
          total: askable.length,
          done,
          status: outcome,
          offers: got,
          lows: gotLows.length ? gotLows : undefined,
          includedIn: gotIncluded.length ? gotIncluded : undefined,
        });
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
  return {
    offers: deduped,
    partial: status.some((s) => !s.ok),
    sources: status,
    lows: lows.length ? bestLows(lows) : undefined,
    includedIn: includedIn.length ? dedupeInclusions(includedIn) : undefined,
  };
}
