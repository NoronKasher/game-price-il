import { CHEAPSHARK_HEADERS } from './adapters/cheapsharkStores.ts';
import { describeProduct } from './normalize.ts';
import { listWishlist } from './db.ts';

/**
 * Title suggestions for the search box.
 *
 * The real search fans out to fifteen sources and takes seconds — far too slow
 * to run on every keystroke, and rude to the stores besides. Suggestions come
 * instead from CheapShark's catalog, which answers one keyless request in a
 * couple of hundred milliseconds, plus the user's own tracked games (which they
 * are most likely to be looking for again).
 *
 * CheapShark is a PC catalog, so a console-only title won't be suggested. That
 * is a gap, not a bug: suggestions are a shortcut, and anything typed in full
 * still searches every source. Filling it would mean querying the console
 * stores per keystroke, which is exactly what this avoids.
 */

const BASE = 'https://www.cheapshark.com/api/1.0';
const CACHE_TTL = 10 * 60 * 1000;
const MAX = 8;
/** Below this, a query matches so much that the list is noise. */
const MIN_CHARS = 2;

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
        // Collapse editions so "Deluxe"/"Ultimate" don't crowd out other games.
        const base = describeProduct(g.external).base.trim();
        const k = base.toLowerCase();
        if (!base || seen.has(k)) continue;
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

/** Up to MAX title suggestions for a partial query. */
export async function suggestTitles(raw: string): Promise<string[]> {
  const q = raw.trim();
  if (q.length < MIN_CHARS) return [];
  const mine = fromWishlist(q);
  const alias = aliasFor(q);
  const theirs = alias
    ? [...(await fromCheapshark(alias)), ...(await fromCheapshark(q))]
    : await fromCheapshark(q);
  const seen = new Set(mine.map((t) => t.toLowerCase()));
  const out = [...mine];
  for (const t of theirs) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX) break;
  }
  return out;
}
