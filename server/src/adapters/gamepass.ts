/**
 * Which games a subscription already covers.
 *
 * The cheapest price for a game you already have access to is nothing, and a
 * board that lists eight regional prices for a title sitting in the buyer's own
 * Game Pass library has answered the wrong question completely. Nobody else
 * comparing prices for Israel says this.
 *
 * Microsoft publishes the lists themselves. `catalog.gamepass.com/sigls/v2` is
 * the same endpoint the Game Pass site calls to render its own catalogue: give
 * it a list id and a market and it returns that market's product ids. They are
 * the SAME Microsoft Store ProductIds the Xbox adapter already keys on, so
 * membership is a set lookup rather than a new scraper — no page is read, no
 * protection is anywhere near this.
 *
 * MARKET MATTERS. A game in the US catalogue is not necessarily in the Israeli
 * one, and answering from the wrong market would be worse than saying nothing:
 * it would tell an Israeli buyer not to buy something they cannot actually play
 * for free. Every list here is fetched for IL.
 *
 * The lists rotate — titles leave Game Pass monthly — so this is cached for
 * hours, not days, and the UI says "in the catalogue now" rather than making a
 * promise about next month.
 */

const SIGLS = 'https://catalog.gamepass.com/sigls/v2';

/** Courtesy identifier. This is a public endpoint, but polite clients name themselves. */
const HEADERS = {
  'User-Agent': 'GamePriceIL/0.1 (personal game price tracker; noron10@gmail.com)',
};

/** The market whose catalogue we answer for. This tool is for Israeli buyers. */
const MARKET = 'IL';

/**
 * The three lists, verified live against market=IL (611 / 522 / 83 titles).
 *
 * These ids are Microsoft's own and are stable — they are what the Game Pass
 * site itself requests. If one ever stops resolving, `refresh` leaves that tier
 * empty rather than throwing: a missing badge is a far smaller failure than a
 * board that will not load.
 */
export const TIERS = [
  { id: 'gamepass-console', sigl: 'f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e', name: 'Xbox Game Pass', nameHe: 'Xbox Game Pass (קונסולה)' },
  { id: 'gamepass-pc', sigl: 'fdd9e2a7-0fee-49f6-ad69-4354098401ff', name: 'PC Game Pass', nameHe: 'PC Game Pass' },
  { id: 'eaplay', sigl: 'b8900d09-a491-44cc-916e-32b5acae621b', name: 'EA Play', nameHe: 'EA Play' },
] as const;

export type TierId = (typeof TIERS)[number]['id'];

/** A subscription that already covers a game. */
export interface Inclusion {
  id: string;
  /** Hebrew display name — this goes straight onto the board. */
  name: string;
  /** Whose catalogue this was read from. Never omitted: it is the whole caveat. */
  market: string;
}

interface Cached {
  ids: Set<string>;
  at: number;
}

/**
 * Six hours. Long enough that a browsing session costs three requests at most,
 * short enough that a title leaving the catalogue stops being advertised the
 * same day rather than the same week.
 */
const TTL = 6 * 60 * 60 * 1000;

const cache = new Map<string, Cached>();
/** In-flight fetches, so ten games opened at once cause one request, not ten. */
const pending = new Map<string, Promise<Set<string>>>();

/**
 * The response is a list whose FIRST element is the list's own metadata (title,
 * description, image) and whose remaining elements are `{ id }`. Filtering on
 * the presence of `id` rather than dropping element zero means a shape change at
 * Microsoft's end degrades to "fewer ids" instead of "the first game is missing".
 */
function readIds(body: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(body)) return ids;
  for (const entry of body) {
    const id = (entry as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id.trim()) ids.add(id.trim().toUpperCase());
  }
  return ids;
}

async function listFor(sigl: string): Promise<Set<string>> {
  const hit = cache.get(sigl);
  if (hit && Date.now() - hit.at < TTL) return hit.ids;
  const inFlight = pending.get(sigl);
  if (inFlight) return inFlight;

  const work = (async () => {
    const url = `${SIGLS}?id=${encodeURIComponent(sigl)}&language=en-us&market=${MARKET}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`gamepass sigl ${res.status}`);
    const ids = readIds(await res.json());
    cache.set(sigl, { ids, at: Date.now() });
    return ids;
  })();

  pending.set(sigl, work);
  try {
    return await work;
  } catch {
    // A list we could not read is an empty list for now. Stale data would be
    // worse: telling somebody a game is free when it left the catalogue months
    // ago is the one mistake this feature can make that costs money.
    cache.set(sigl, { ids: new Set(), at: Date.now() });
    return new Set();
  } finally {
    pending.delete(sigl);
  }
}

/**
 * Which subscriptions carry this Microsoft Store product in Israel, if any.
 *
 * Never throws: this is a nice-to-have beside a price board, and a subscription
 * lookup must not be able to take the prices down with it.
 */
export async function inclusionsFor(productId: string): Promise<Inclusion[]> {
  const id = productId.trim().toUpperCase();
  if (!id) return [];
  const found: Inclusion[] = [];
  await Promise.all(
    TIERS.map(async (tier) => {
      try {
        if ((await listFor(tier.sigl)).has(id)) {
          found.push({ id: tier.id, name: tier.nameHe, market: MARKET });
        }
      } catch {
        /* handled in listFor; here only so one tier cannot fail the rest */
      }
    })
  );
  // Stable order, so the badges do not shuffle between two openings of the same
  // game just because one list answered faster.
  const order = TIERS.map((t) => t.id) as string[];
  return found.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** Test seam: drop the cached lists so a case can install its own. */
export function __resetGamePassCache(): void {
  cache.clear();
  pending.clear();
}
