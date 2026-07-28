/**
 * Search-query parser for the game-price-il price comparison tool.
 *
 * Extracts platform filters (English and Hebrew tokens) from a free-text
 * game search query, returning the cleaned title plus the list of
 * requested platforms.
 *
 * Self-contained: no external dependencies.
 */

/**
 * A supported gaming platform identifier.
 */
export type Platform = 'pc' | 'ps5' | 'ps4' | 'xbox-series' | 'xbox-one' | 'switch';

/**
 * The result of parsing a free-text search query.
 */
export interface ParsedQuery {
  /** Query with platform tokens removed, trimmed, single-spaced. */
  title: string;
  /** Requested platforms; empty array = no platform filter (search all). */
  platforms: Platform[];
}

/**
 * A single token rule: a sequence of lowercase words that, when matched
 * against consecutive words of the query, maps to one or more platforms.
 */
interface TokenRule {
  /** The token as a sequence of lowercase words (multi-word tokens supported). */
  words: string[];
  /** Platforms this token maps to (some tokens map to more than one). */
  platforms: Platform[];
}

/**
 * Token table (token -> platform(s)), English and Hebrew.
 *
 * Order in this list does not matter; rules are sorted longest-first
 * (by word count, then by character length) before matching, so e.g.
 * "xbox series x" wins over "xbox series", which wins over bare "xbox".
 */
const TOKEN_RULES: TokenRule[] = [
  // PC
  { words: ['pc'], platforms: ['pc'] },
  { words: ['מחשב'], platforms: ['pc'] },
  { words: ['steam'], platforms: ['pc'] },
  { words: ['סטים'], platforms: ['pc'] },
  // PlayStation 5
  { words: ['ps5'], platforms: ['ps5'] },
  { words: ['ps', '5'], platforms: ['ps5'] },
  { words: ['playstation', '5'], platforms: ['ps5'] },
  { words: ['פלייסטיישן', '5'], platforms: ['ps5'] },
  { words: ['פס5'], platforms: ['ps5'] },
  // PlayStation 4
  { words: ['ps4'], platforms: ['ps4'] },
  { words: ['ps', '4'], platforms: ['ps4'] },
  { words: ['playstation', '4'], platforms: ['ps4'] },
  { words: ['פלייסטיישן', '4'], platforms: ['ps4'] },
  { words: ['פס4'], platforms: ['ps4'] },
  // PlayStation (generation unspecified -> both)
  { words: ['playstation'], platforms: ['ps5', 'ps4'] },
  { words: ['פלייסטיישן'], platforms: ['ps5', 'ps4'] },
  // Xbox Series
  { words: ['xbox', 'series', 'x'], platforms: ['xbox-series'] },
  { words: ['xbox', 'series', 's'], platforms: ['xbox-series'] },
  { words: ['xbox', 'series'], platforms: ['xbox-series'] },
  { words: ['אקסבוקס', 'סריס'], platforms: ['xbox-series'] },
  // Xbox One
  { words: ['xbox', 'one'], platforms: ['xbox-one'] },
  { words: ['אקסבוקס', 'וואן'], platforms: ['xbox-one'] },
  // Xbox (generation unspecified -> both)
  { words: ['xbox'], platforms: ['xbox-series', 'xbox-one'] },
  { words: ['אקסבוקס'], platforms: ['xbox-series', 'xbox-one'] },
  // Nintendo Switch
  { words: ['nintendo', 'switch'], platforms: ['switch'] },
  { words: ['switch'], platforms: ['switch'] },
  { words: ['סוויץ'], platforms: ['switch'] },
  { words: ["סוויץ'"], platforms: ['switch'] },
  { words: ['נינטנדו'], platforms: ['switch'] },
];

/**
 * Token rules sorted longest-first: primarily by word count (descending),
 * secondarily by total character length (descending). This guarantees that
 * "xbox series x" is tried before "xbox series", which is tried before
 * "xbox", so no partial leftovers (like a stray "x") remain and shorter
 * rules never fire inside a longer match.
 */
const SORTED_RULES: TokenRule[] = [...TOKEN_RULES].sort((a, b) => {
  if (b.words.length !== a.words.length) {
    return b.words.length - a.words.length;
  }
  return b.words.join(' ').length - a.words.join(' ').length;
});

/**
 * Tests whether the rule's word sequence matches the query words starting
 * at the given index. Comparison is done on whole, pre-lowercased words,
 * so matching is inherently word-boundary safe for both Latin and Hebrew
 * text (no regex \b involved): "pspice" can never match the "ps" token.
 *
 * @param lowerWords - The query words, lowercased.
 * @param start - Index into `lowerWords` at which to attempt the match.
 * @param rule - The token rule to test.
 * @returns True if every word of the rule matches consecutively.
 */
function matchesAt(lowerWords: string[], start: number, rule: TokenRule): boolean {
  if (start + rule.words.length > lowerWords.length) {
    return false;
  }
  for (let j = 0; j < rule.words.length; j++) {
    if (lowerWords[start + j] !== rule.words[j]) {
      return false;
    }
  }
  return true;
}

/**
 * Parses a free-text game search query, extracting platform filters.
 *
 * Matching is case-insensitive, supports English and Hebrew tokens
 * (including multi-word tokens), and operates on whole words only:
 * the query is split on whitespace and token word-sequences are compared
 * against consecutive query words (longest tokens first). Matched tokens
 * are removed from the title; remaining words keep their original casing
 * and are re-joined with single spaces.
 *
 * Platforms are deduplicated, preserving first-seen order.
 *
 * @example
 * parseQuery('FIFA 2020 PS4');
 * // => { title: 'FIFA 2020', platforms: ['ps4'] }
 * @example
 * parseQuery('fifa 2020');
 * // => { title: 'fifa 2020', platforms: [] }
 *
 * @param raw - The raw user query (may be empty or whitespace-only).
 * @returns The cleaned title and the list of requested platforms.
 */
export function parseQuery(raw: string): ParsedQuery {
  const words: string[] = raw.split(/\s+/u).filter((w) => w.length > 0);
  const lowerWords: string[] = words.map((w) => w.toLowerCase());

  const keptWords: string[] = [];
  const platforms: Platform[] = [];
  const seen = new Set<Platform>();

  let i = 0;
  while (i < words.length) {
    let matched: TokenRule | undefined;
    for (const rule of SORTED_RULES) {
      if (matchesAt(lowerWords, i, rule)) {
        matched = rule;
        break;
      }
    }
    if (matched !== undefined) {
      for (const platform of matched.platforms) {
        if (!seen.has(platform)) {
          seen.add(platform);
          platforms.push(platform);
        }
      }
      i += matched.words.length;
    } else {
      const original = words[i];
      if (original !== undefined) {
        keptWords.push(original);
      }
      i += 1;
    }
  }

  return {
    title: keptWords.join(' '),
    platforms,
  };
}
