import { parseQuery, type Platform } from './search.ts';

/**
 * Title utilities shared by adapters. Store product names are messy — they mix
 * in the platform ("ELDEN RING PS5"), the edition ("...: Ultimate Edition"),
 * and even non-games (racing wheels, Funko figures). These helpers turn a raw
 * store title into a clean game description the UI can group and display:
 *   - `base`      clean display name (no platform, no edition, no junk)
 *   - `edition`   the edition label ("Ultimate", "Collector's"...) or null
 *   - `platforms` platforms named in the title
 *   - `groupKey`  normalized base, so every edition/source of one game groups
 *   - `accessory` true when the title looks like hardware, not a game
 */

export interface ProductDescription {
  base: string;
  edition: string | null;
  platforms: Platform[];
  groupKey: string;
  accessory: boolean;
  /** Add-on content (season pass, credits, soundtrack…) rather than a game. */
  dlc: boolean;
}

/** Edition qualifier words that can precede "Edition"/"Bundle" or stand alone at the end. */
const EDITION_QUALIFIER =
  "game of the year|goty|ultimate|deluxe|gold|premium|standard|complete|definitive|special|collector'?s|collectors|anniversary|legendary|digital|launch|enhanced|platinum|essential|remastered|remaster|day[\\s-]?one|cross[\\s-]?gen|super deluxe";

/**
 * Trailing-edition matcher. Anchored to the END of the title so it strips
 * "…: Ultimate Edition" or "… Deluxe" but never touches a sequel number or a
 * mid-name word. Matches: "<qualifier> Edition", a bare "<qualifier>",
 * "…Edition", or "<qualifier>? Bundle".
 */
const TRAILING_EDITION = new RegExp(
  `\\s*[:\\-–|]?\\s*\\b((?:${EDITION_QUALIFIER})(?:\\s+edition)?|edition|(?:${EDITION_QUALIFIER})?\\s*bundle)\\s*$`,
  'i'
);

/** Hebrew edition words sometimes trail the title too. */
const TRAILING_EDITION_HE = /\s*[-–|]?\s*(מהדורת\s+\S+|מהדורה(?:\s+\S+)?|דלוקס|אולטימטיבית)\s*$/;

/** Strong accessory / non-game signals (hardware, collectibles, console bundles), Hebrew + English. */
const ACCESSORY_EN =
  /\b(controller|gamepad|joystick|headset|headphones?|thrustmaster|eswap|cockpit|pedals?|shifter|steering|racing wheel|driving wheel|funko|pop!|amiibo|figure|figurine|statue|carrying case|charging|charger|keyboard|mousepad|webcam|dualsense|dualshock|console|oled)\b/i;
const ACCESSORY_HE =
  /(אוזניות|בקר\b|ג'ויסטיק|הגה|חבילת נהיגה|דוושות|כיסא גיימינג|מטען|פאנקו|בובת|דמות אספנים|תיק נשיאה|מעמד טעינה|קונסולה|עם שלט|שלט אלחוטי|שלט למשחק|שלט)/;

/**
 * Add-on content sold beside a game: season passes, expansion packs, currency,
 * soundtracks, upgrades. These are not games, but stores return them from a
 * search for the game, so without this a search for Far Cry 6 answers with
 * cards for its Starter Pack, Base Pack and Season Pass.
 *
 * Keyword-based and deliberately conservative. Some DLC is named with no tell at
 * all — Far Cry 6's episodes are called "Collapse" and "Insanity" — and the only
 * way to catch those would be to assume any title extending another title is an
 * add-on, which would swallow every sequel ("Far Cry" vs "Far Cry 2"). Missing a
 * few add-ons is a much smaller harm than hiding a game, so those stay.
 */
const DLC_EN = new RegExp(
  '\\b(' +
    [
      'season\\s*pass',
      'expansion\\s*pass',
      'expansion',
      'dlc',
      'add[\\s-]?ons?',
      '(?:car|course|content|premium|expansion|season|battle|upgrade)\\s*pass',
      'additional',
      'soundtrack',
      'starter\\s*pack',
      'base\\s*pack',
      'upgrade\\s*(?:pass|pack|edition)',
      // "…Deluxe Upgrade", "…Digital Deluxe Edition Upgrade": here the word
      // upgrade TRAILS the edition name instead of leading it, so the pattern
      // above never matched and EA's "Jedi: Fallen Order Deluxe Upgrade" was
      // offered as a game. An upgrade is something bought on top of a game you
      // already own — an add-on by any reading.
      //
      // Anchored to the edition words rather than matching "upgrade" alone,
      // which would swallow a game actually called "Upgrade" — and there is one.
      '(?:deluxe|digital|standard|ultimate|premium|gold|complete|collector\'?s)\\s+(?:\\w+\\s+)?upgrade',
      // Language and voiceover downloads. Switch cartridges are small, so
      // Nintendo ships each dub as its own free "product" — nine of them turned
      // up as games in a search for Cyberpunk 2077. Nobody shops for these.
      '(?:voice[\\s-]?over|voice|language|audio|subtitle|text|dub)\\s*pack',
      'pre[\\s-]?order\\s*bonus',
      'map\\s*pack',
      'character\\s*pack',
      'skin\\s*pack',
      'weapon\\s*pack',
      'booster\\s*pack',
      '(?:small|medium|large|x-?large|mega|huge|jumbo)\\s*pack',
      'episode\\s*\\d',
      'in-?game\\s*commentary',
      'battle\\s*pass',
      'free\\s*trial',
      'demo',
      '(?:closed|open)\\s*beta',
    ].join('|') +
    ')\\b',
  'i'
);

/**
 * In-game currency, which is only an add-on when it is QUANTIFIED or PACKAGED.
 *
 * A bare word will not do: "Coin Crypt" is a real game, and matching "coins?"
 * on its own hid it from search. Real currency listings always carry an amount
 * ("2400 Credits", "1,000,000 Coins") or say pack ("2200 FUT Points Pack"), so
 * that is what we require.
 */
const DLC_CURRENCY = new RegExp(
  '\\b(?:\\d[\\d,.]*\\s*(?:fut\\s*)?(?:coins?|credits?|points?|v-?bucks)|(?:coins?|credits?|points?|v-?bucks|currency)\\s*pack)\\b',
  'i'
);
const DLC_HE = /(חבילת\s*הרחבה|הרחבה|פס\s*קול|חבילת\s*מטבעות)/;

/**
 * An upgrade sold on top of a game you already own, named without any of the
 * edition words above: "Diablo IV Prime Evil Upgrade", "Cyberpunk 2077 Phantom
 * Liberty Upgrade". Those are add-ons and were being offered as games.
 *
 * The test is POSITIONAL rather than another keyword, because "upgrade" on its
 * own is a perfectly ordinary word in a game's name. It counts only as the final
 * word of a title with at least three of them:
 *   "Diablo IV Prime Evil Upgrade"  → 5 words, ends with upgrade → add-on
 *   "Upgrade Simulator"             → does not end with it       → game
 *   "The Upgrade"                   → only 2 words               → game
 */
function looksLikeUpgradeProduct(title: string): boolean {
  const words = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length < 3) return false;
  const last = words[words.length - 1]!;
  return last === 'upgrade' || last === 'שדרוג';
}

/** True when a listing is add-on content rather than the game itself. */
export function looksLikeDlc(title: string): boolean {
  return DLC_EN.test(title) || DLC_CURRENCY.test(title) || DLC_HE.test(title) || looksLikeUpgradeProduct(title);
}

/** True when a store listing looks like an accessory/collectible rather than a game. */
export function looksLikeAccessory(title: string): boolean {
  return ACCESSORY_EN.test(title) || ACCESSORY_HE.test(title);
}

/** Title-case an edition label; normalize a couple of long forms to short ones. */
function editionLabel(raw: string): string | null {
  let s = raw.replace(/\bedition\b/i, '').replace(/[|\-–:]/g, ' ').trim();
  if (!s) return null; // was just the word "Edition" — meaningless on its own
  // "Standard" IS the base game (shown as רגילה), not a distinct edition — treat
  // as no edition so a "Standard Edition" disc groups with edition-less listings.
  if (/^standard$/i.test(s)) return null;
  if (/^game of the year$/i.test(s) || /^goty$/i.test(s)) return 'GOTY';
  return s
    .split(/\s+/)
    .map((w) => (w.length ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/** Strip leading store artifacts ("+ ", "| ", stray separators). */
function cleanLeading(title: string): string {
  return title.replace(/^[\s+|\-–:]+/, '').trim();
}

/**
 * Language / audio tokens Israeli physical stores append to disc titles
 * ("EA Sports FC 25 English Arabic", "…עברית"). Stripped from the END so those
 * discs group with the same base game from other stores.
 */
const LANGUAGE_TOKENS =
  'english|arabic|hebrew|french|german|spanish|italian|russian|japanese|korean|chinese|portuguese|turkish|polish|dutch|multi[\\s-]?language|multilang|עברית|אנגלית|ערבית';
const TRAILING_LANGUAGE = new RegExp(
  `(?:\\s*[-–|/,]?\\s*\\b(?:${LANGUAGE_TOKENS})\\b)+\\s*$`,
  'i'
);

/** Full description of a raw store product title. */
export function describeProduct(rawTitle: string): ProductDescription {
  // Normalize curly/back apostrophes so "Collector’s Edition" matches.
  const raw = rawTitle.replace(/[’`´]/g, "'");
  const accessory = looksLikeAccessory(raw);
  const dlc = looksLikeDlc(raw);

  // 1. platform tokens out (also handles pipe/slash separators)
  const { title: noPlatform, platforms } = stripPlatformTokens(cleanLeading(raw));

  // 2. trailing edition out — try Hebrew then English, once each is enough in practice
  let base = noPlatform;
  let edition: string | null = null;

  const heMatch = base.match(TRAILING_EDITION_HE);
  if (heMatch && heMatch.index !== undefined && heMatch.index > 0) {
    edition = heMatch[1]?.trim() ?? null;
    base = base.slice(0, heMatch.index).trim();
  }

  const enMatch = base.match(TRAILING_EDITION);
  if (enMatch && enMatch.index !== undefined && enMatch.index > 0 && enMatch[1]) {
    const label = editionLabel(enMatch[1]);
    // Only strip if something remains as the game name (don't eat the whole title).
    const remainder = base.slice(0, enMatch.index).trim();
    if (remainder) {
      base = remainder;
      edition = edition ?? label;
    }
  }

  // 3. trailing disc-language tokens out (don't eat the whole title)
  const langStripped = base.replace(TRAILING_LANGUAGE, '').trim();
  if (langStripped) base = langStripped;

  base = cleanLeading(base) || noPlatform || rawTitle;

  return {
    base,
    edition,
    platforms,
    groupKey: normalizeKey(base),
    accessory,
    dlc,
  };
}

/** Remove platform tokens from a product title, keeping original casing. */
export function stripPlatformTokens(title: string): { title: string; platforms: Platform[] } {
  // Strip a trailing platform-only parenthetical ("Red Dead Redemption (PC)")
  // so it groups with the un-tagged title; keep meaningful parentheticals.
  const untagged = title.replace(/\s*\(([^)]*)\)\s*$/, (m, inner: string) =>
    parseQuery(inner.replace(/[|/]/g, ' ')).title.trim() === '' ? ' ' : m
  );
  const cleaned = untagged.replace(/[|/]/g, ' ');
  const parsed = parseQuery(cleaned);
  return { title: parsed.title || title, platforms: parsed.platforms };
}

/**
 * Lowercased, punctuation- and accent-free key for grouping, so international
 * spellings unify ("Ragnarök" from PSN and "Ragnarok" from a local store are
 * the same game).
 */
/**
 * Roman numerals a game title actually uses, mapped to digits.
 *
 * Stores cannot agree how to write a sequel: Steam and CheapShark say "Diablo
 * IV", Arcadia says "Diablo 4", and the tool filed them as two different games.
 * Same for "Final Fantasy VII" / "Final Fantasy 7" and "The Last of Us Part I" /
 * "Part 1". Normalising one way makes every one of those pairs meet.
 */
const ROMAN: Record<string, string> = {
  ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9',
  xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16',
  xvii: '17', xviii: '18', xix: '19', xx: '20',
};

/**
 * Convert roman numerals to digits, but only where they are certainly numerals.
 *
 * Multi-letter numerals are unambiguous — no game is called "Ix" or "Vii". The
 * SINGLE letters are not: "I", "V", "X", "C", "D", "M" and "L" are all common
 * words or initials, and blindly converting them would turn "I Am Setsuna" into
 * "1 am setsuna" and "X-Men" into "10 men". So single letters convert only as
 * the LAST word of a multi-word title, which is where a sequel number lives —
 * "Grand Theft Auto V" → 5, while "X-Men" and "I Am Setsuna" are untouched.
 * Even then only I, V and X, since a title ending in "C" or "M" is far more
 * likely to be an initial than a hundred.
 */
const TRAILING_ROMAN: Record<string, string> = { i: '1', v: '5', x: '10' };

function normalizeNumerals(key: string): string {
  const words = key.split(' ');
  return words
    .map((w, i) => {
      if (ROMAN[w]) return ROMAN[w];
      const last = i === words.length - 1;
      if (last && words.length > 1 && TRAILING_ROMAN[w]) return TRAILING_ROMAN[w];
      return w;
    })
    .join(' ');
}

function normalizeKey(base: string): string {
  const flat = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics: ö→o, é→e
    .toLowerCase()
    // Apostrophes are DELETED, not turned into a space like other punctuation.
    // Stores disagree about possessives — Steam writes "Assassin's Creed",
    // Israeli shops write "Assassins Creed" — and splitting on the apostrophe
    // made those "assassin s creed" and "assassins creed": two different games.
    // Same for Marvel's Spider-Man, Tom Clancy's, Sid Meier's, Baldur's Gate.
    .replace(/['’`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return normalizeNumerals(flat);
}

/** Normalized grouping key for a raw title (base game, editions collapsed). */
export function groupKey(title: string): string {
  return describeProduct(title).groupKey;
}

/**
 * Filler words that carry no matching signal, so they never make an unrelated
 * product "match" a query (both English and common Hebrew glue words). Edition
 * words are already stripped from titles, but a query might still contain them.
 */
const MATCH_STOPWORDS = new Set([
  'the', 'of', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'on', 'with',
  'edition', 'game', 'games', 'ps4', 'ps5', 'xbox', 'switch', 'pc',
  'של', 'עם', 'למשחק', 'משחק', 'לקונסולת', 'ל',
]);

/** Significant, accent-free lowercase words of a title, for relevance matching. */
function matchTokens(s: string): string[] {
  return normalizeKey(s)
    .split(' ')
    .filter((tok) => tok.length >= 2 && !MATCH_STOPWORDS.has(tok));
}

/**
 * Relevance guard for store-search scrapers. A shop's built-in search is broad —
 * it matches product descriptions, tags and categories, not just the name — so a
 * query like "fallout" pulls back repair services, cleaning listings and unrelated
 * games that happen to sit in the same catalog. We keep a scraped result only when
 * its title actually shares a meaningful word with the query. Proper game APIs
 * (Steam, PSN, CheapShark…) already return real title matches and skip this.
 *
 * Match is lenient on purpose (one shared word is enough) so franchise sequels and
 * reordered titles survive; only truly unrelated products, which share nothing, are
 * dropped. Short tokens (2–3 chars) must match exactly; longer ones also match as a
 * substring, so "Fallout" still finds "Fallout4" and "God of War" finds "Godwar".
 */
export function titleMatchesQuery(query: string, productTitle: string): boolean {
  const qTokens = matchTokens(query);
  if (qTokens.length === 0) return true; // query was only filler — nothing to gate on
  const pTokens = matchTokens(productTitle);
  if (pTokens.length === 0) return false;
  const pSet = new Set(pTokens);
  return qTokens.some((q) => {
    if (pSet.has(q)) return true;
    if (q.length >= 4) {
      return pTokens.some((p) => p.length >= 4 && (p.includes(q) || q.includes(p)));
    }
    return false;
  });
}

/** Parse "1,649.00 ₪" / "329.00 ₪" style price text to a number. */
export function parseNis(text: string): number | null {
  const m = text.replace(/[,\s]/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Heuristic: store product titles mentioning a digital code are not discs. */
export function looksDigital(title: string): boolean {
  return /digital|דיגיטלי|קוד/i.test(title);
}

/**
 * Parse a localized price string ("1.399,50 TL", "₪249.90", "¥ 2,640") to a
 * number. Storefronts that only render a formatted price — rather than a
 * machine-readable amount — are read through this, so it has to survive every
 * separator convention we meet.
 *
 * The trailing separator is a decimal point only when it is followed by 1–2
 * digits ("1.399,50"→1399.5, "£59.99"→59.99); a separator followed by 3 digits
 * is a thousands group ("₹2,499"→2499, "R 1,559"→1559). Non-decimal separators
 * are thousands and are stripped.
 */
export function parseLocalizedPrice(text: string): number | null {
  const digits = text.replace(/[^\d.,]/g, '');
  if (!digits) return null;
  const lastSep = Math.max(digits.lastIndexOf(','), digits.lastIndexOf('.'));
  let normalized: string;
  if (lastSep === -1) {
    normalized = digits;
  } else {
    const decimals = digits.length - lastSep - 1;
    if (decimals >= 1 && decimals <= 2) {
      const intPart = digits.slice(0, lastSep).replace(/[.,]/g, '');
      normalized = `${intPart}.${digits.slice(lastSep + 1)}`;
    } else {
      normalized = digits.replace(/[.,]/g, '');
    }
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
