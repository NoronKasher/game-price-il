import { CHEAPSHARK_HEADERS } from './adapters/cheapsharkStores.ts';
import { describeProduct, looksLikeDlc } from './normalize.ts';
import { listWishlist } from './db.ts';
import { xbox } from './adapters/xbox.ts';
import { nintendo } from './adapters/nintendo.ts';

/**
 * Title suggestions for the search box.
 *
 * The real search fans out to fifteen sources and takes seconds — far too slow
 * to run on every keystroke, and rude to the stores besides. Suggestions come
 * instead from CheapShark's catalog, which answers one keyless request in a
 * couple of hundred milliseconds, plus the user's own tracked games (which they
 * are most likely to be looking for again).
 *
 * Console titles come from Xbox's and Nintendo's own typeahead endpoints, which
 * are built for exactly this and answer in 100–450ms. PlayStation is left out on
 * purpose: it takes 600–800ms, which is too slow to sit behind a keystroke, and
 * its short-query results are mostly noise.
 *
 * Every source is raced against a hard budget and whatever answers in time
 * contributes — a slow store costs the user nothing but its own suggestions.
 */

const BASE = 'https://www.cheapshark.com/api/1.0';
const CACHE_TTL = 10 * 60 * 1000;
const MAX = 8;
/** Below this, a query matches so much that the list is noise ("gt" → "RagTag"). */
const MIN_CHARS = 3;
/** Console stores are only asked once the query is specific enough to be worth it. */
const MIN_CHARS_CONSOLE = 3;
/** A suggestion that arrives after this is useless — the user has typed on. */
const BUDGET_MS = 700;

/** Resolve to [] rather than hang the whole list on one slow store. */
function within<T>(p: Promise<T[]>, ms: number): Promise<T[]> {
  return Promise.race([p.catch(() => [] as T[]), new Promise<T[]>((r) => setTimeout(() => r([]), ms))]);
}

/**
 * Store search is fuzzy: Nintendo answers "forza" with "Ghost Strike", PSN
 * answers "zeld" with "The Legacy of Griselda". A suggestion list is a promise
 * that the title is what you meant, so anything not actually containing what was
 * typed is dropped.
 */
function looksRelevant(title: string, q: string): boolean {
  const clean = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .toLowerCase()
      .trim();
  return clean(title).includes(clean(q));
}

const cache = new Map<string, { titles: string[]; at: number }>();
/** Cap the cache so a long-running server can't accumulate every prefix ever typed. */
const MAX_CACHE = 200;

/**
 * What people type vs. what the catalog calls it.
 *
 * Searching "fifa" returns literally nothing — EA renamed the series to EA
 * SPORTS FC and the old titles were delisted — yet FIFA is one of the names an
 * Israeli player is most likely to type. The same goes for the abbreviations
 * everyone uses out loud but no store puts in a product name.
 *
 * These lead the list rather than only filling an empty one, because the fuzzy
 * catalog search DOES answer them — with rubbish. "gta" matches "RagTag" and
 * "Flying Tank"; "cod" matches "CODA" and "Encodya". No game is actually named
 * any of these abbreviations, so the expansion is always the better answer, and
 * the raw matches are appended after it rather than thrown away.
 *
 * Kept deliberately short: only unambiguous ones. "ac" is not here — it could be
 * Assassin's Creed or half a dozen other things, and a wrong guess at the top of
 * the list is worse than no guess.
 */
const ALIASES: [RegExp, string][] = [
  [/^fifa\b/i, 'EA SPORTS FC'],
  [/^(pes|winning eleven)\b/i, 'eFootball'],
  [/^cod\b/i, 'Call of Duty'],
  [/^gta\b/i, 'Grand Theft Auto'],
  [/^rdr\b/i, 'Red Dead Redemption'],
  [/^nfs\b/i, 'Need for Speed'],
];

function aliasFor(q: string): string | null {
  for (const [re, title] of ALIASES) if (re.test(q.trim())) return title;
  return null;
}

interface CsGame {
  external?: string;
  steamAppID?: string | null;
}

/** Tracked games whose title contains the query — the user's own shortlist first. */
function fromWishlist(q: string): string[] {
  const needle = q.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of listWishlist()) {
    const title = row.title.trim();
    const key = title.toLowerCase();
    if (!key.includes(needle) || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
    if (out.length >= 3) break;
  }
  return out;
}

async function fromCheapshark(q: string): Promise<string[]> {
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.titles;
  let titles: string[] = [];
  try {
    const res = await fetch(`${BASE}/games?title=${encodeURIComponent(q)}&limit=20`, {
      headers: CHEAPSHARK_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    // A throttled or unhappy CheapShark just means no suggestions this keystroke;
    // the box stays usable and the real search is unaffected.
    if (res.ok) {
      const games = (await res.json()) as CsGame[];
      const seen = new Set<string>();
      for (const g of games) {
        if (!g.external) continue;
        // Add-ons are opt-in in search, so suggesting them here would offer the
        // user something the results then hide.
        if (looksLikeDlc(g.external)) continue;
        // Collapse editions so "Deluxe"/"Ultimate" don't crowd out other games.
        const base = describeProduct(g.external).base.trim();
        const k = base.toLowerCase();
        if (!base || seen.has(k) || !looksRelevant(base, q)) continue;
        seen.add(k);
        titles.push(base);
      }
    }
  } catch {
    titles = [];
  }
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, { titles, at: Date.now() });
  return titles;
}

/** Titles from a console store's own search, kept only if actually relevant. */
async function fromConsole(adapter: typeof xbox | typeof nintendo, q: string): Promise<string[]> {
  const hits = await adapter.search(q, adapter.platforms);
  const out: string[] = [];
  for (const h of hits) {
    if (looksLikeDlc(h.title)) continue;
    const title = describeProduct(h.title).base.trim();
    if (!title || !looksRelevant(title, q)) continue;
    out.push(title);
  }
  return out;
}

export async function suggestTitles(raw: string): Promise<string[]> {
  const q = raw.trim();
  if (q.length < MIN_CHARS) return [];
  const mine = fromWishlist(q);
  const alias = aliasFor(q);

  const lists = await Promise.all([
    within(alias ? fromCheapshark(alias) : fromCheapshark(q), BUDGET_MS),
    within(alias ? fromCheapshark(q) : Promise.resolve([]), BUDGET_MS),
    q.length >= MIN_CHARS_CONSOLE ? within(fromConsole(xbox, q), BUDGET_MS) : Promise.resolve([]),
    q.length >= MIN_CHARS_CONSOLE ? within(fromConsole(nintendo, q), BUDGET_MS) : Promise.resolve([]),
  ]);

  // Round-robin across the sources so one big catalog can't crowd out the rest.
  const seen = new Set(mine.map((t) => t.toLowerCase()));
  const out = [...mine];
  for (let i = 0; out.length < MAX; i++) {
    let added = false;
    for (const list of lists) {
      const t = list[i];
      if (!t) continue;
      added = true;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= MAX) break;
    }
    if (!added) break;
  }
  return out;
}
