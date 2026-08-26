/**
 * Searching in Hebrew.
 *
 * Every store this tool queries has an English catalogue, so a search for
 * "סייברפאנק" reaches all sixteen of them and comes back with nothing. Israelis
 * type Hebrew. That gap is the most local thing this project could fix and no
 * international price tool has any reason to.
 *
 * WHY THIS IS A DICTIONARY AND NOT A TRANSLITERATOR.
 *
 * The obvious approach — map Hebrew letters to Latin ones — does not work here,
 * and it is worth writing down why so nobody tries it again. Hebrew does not
 * write vowels, so "סייברפאנק" transliterates to roughly "syybrpank": correct,
 * unreadable, and matching nothing in any store's catalogue. A transliterated
 * query is not a worse search, it is a guaranteed empty one, and shipping it
 * would mean shipping a feature that never works while looking like it should.
 *
 * So this is a dictionary of what people actually type, plus the handful of
 * English words that appear inside titles written in Hebrew letters ("אוף",
 * "דה", "אולטימט"). Anything still in Hebrew after substitution is DROPPED
 * rather than mangled: "זלדה טירס אוף דה קינגדום" becomes "Zelda Tears of the
 * Kingdom" if the words are known and plain "Zelda" if they are not — and a
 * search for Zelda is a useful answer, while a search for "Zelda tyrs" is not.
 *
 * The caller is expected to tell the user what was actually searched for. A
 * silent rewrite of somebody's query is how a tool loses trust the first time
 * it guesses wrong.
 */

/** True when the string contains any Hebrew letter. */
export function hasHebrew(text: string): boolean {
  return /[֐-׿]/.test(text);
}

/**
 * Franchise and title names as Israelis write them.
 *
 * Keys are lowercase Hebrew, values are what the stores actually call the game.
 * Multi-word keys are matched first (see `toLatinQuery`), so "מלחמת הכוכבים"
 * wins over any single word inside it.
 *
 * Deliberately franchise-level rather than per-title: "ספיידרמן 2" should reach
 * Spider-Man 2 without this file needing a row for every sequel, and a franchise
 * search that returns the whole series is a good answer in a price tool.
 */
const ALIASES: Record<string, string> = {
  // Function words that show up inside transliterated titles
  אוף: 'of',
  דה: 'the',
  אנד: 'and',
  אין: 'in',
  אדישן: 'Edition',
  אולטימט: 'Ultimate',
  דלוקס: 'Deluxe',
  גולד: 'Gold',
  קומפליט: 'Complete',
  רימאסטר: 'Remastered',
  רימאסטרד: 'Remastered',
  רימייק: 'Remake',
  דפיניטיב: 'Definitive',

  // PlayStation
  'גוד אוף וור': 'God of War',
  'האחרון מאיתנו': 'The Last of Us',
  'לאסט אוף אס': 'The Last of Us',
  אנצארטד: 'Uncharted',
  'אנצ׳רטד': 'Uncharted',
  ספיידרמן: 'Spider-Man',
  'ספיידר מן': 'Spider-Man',
  הוריזון: 'Horizon',
  'גוסט אוף צושימה': 'Ghost of Tsushima',
  'דת סטרנדינג': 'Death Stranding',
  'גראן טוריסמו': 'Gran Turismo',
  'גראן טורימו': 'Gran Turismo',
  רטשט: 'Ratchet & Clank',

  // Xbox / Microsoft
  היילו: 'Halo',
  הילו: 'Halo',
  פורזה: 'Forza',
  'גירס אוף וור': 'Gears of War',
  'סי אוף ת׳יבס': 'Sea of Thieves',
  סטארפילד: 'Starfield',

  // Nintendo
  זלדה: 'Zelda',
  מריו: 'Mario',
  'סופר מריו': 'Super Mario',
  'מריו קארט': 'Mario Kart',
  פוקימון: 'Pokemon',
  מטרואיד: 'Metroid',
  קירבי: 'Kirby',
  'דונקי קונג': 'Donkey Kong',
  'אנימל קרוסינג': 'Animal Crossing',
  'סמאש ברוס': 'Super Smash Bros',
  ספלטון: 'Splatoon',
  'פייר אמבלם': 'Fire Emblem',
  קסניובלייד: 'Xenoblade',

  // Big multiplatform franchises
  'קול אוף דיוטי': 'Call of Duty',
  'קול אוף דיוטי וורזון': 'Call of Duty Warzone',
  באטלפילד: 'Battlefield',
  'גרנד תפט אוטו': 'Grand Theft Auto',
  'גראנד תפט אוטו': 'Grand Theft Auto',
  'ג׳יטיאיי': 'Grand Theft Auto',
  גיטיאיי: 'Grand Theft Auto',
  'רד דד': 'Red Dead Redemption',
  'אסאסינס קריד': "Assassin's Creed",
  'אססינס קריד': "Assassin's Creed",
  'פאר קריי': 'Far Cry',
  'ווטש דוגס': 'Watch Dogs',
  'ניד פור ספיד': 'Need for Speed',
  פיפא: 'FIFA',
  'פיפ״א': 'FIFA',
  'איי אף סי': 'EA Sports FC',
  מיינקראפט: 'Minecraft',
  פורטנייט: 'Fortnite',
  סוניק: 'Sonic',
  'מורטל קומבט': 'Mortal Kombat',
  טקן: 'Tekken',
  'סטריט פייטר': 'Street Fighter',
  'רזידנט איויל': 'Resident Evil',
  'סיילנט היל': 'Silent Hill',
  'טומב ריידר': 'Tomb Raider',
  היטמן: 'Hitman',
  'מטאל גיר': 'Metal Gear',
  'דארק סולס': 'Dark Souls',
  'אלדן רינג': 'Elden Ring',
  סקירו: 'Sekiro',
  בלאדבורן: 'Bloodborne',
  דיאבלו: 'Diablo',
  וורקראפט: 'Warcraft',
  'וורלד אוף וורקראפט': 'World of Warcraft',
  אוברווטש: 'Overwatch',
  סטארקראפט: 'StarCraft',
  'ליג אוף לג׳נדס': 'League of Legends',
  דוטה: 'Dota',
  'קאונטר סטרייק': 'Counter-Strike',
  ולורנט: 'Valorant',
  'אפקס לג׳נדס': 'Apex Legends',
  'רוקט ליג': 'Rocket League',
  'אמונג אס': 'Among Us',
  'פול גאיז': 'Fall Guys',

  // Story games and RPGs
  סייברפאנק: 'Cyberpunk 2077',
  'הוויצ׳ר': 'The Witcher',
  'ויצ׳ר': 'The Witcher',
  הויצר: 'The Witcher',
  סקיירים: 'Skyrim',
  'אלדר סקרולס': 'The Elder Scrolls',
  פאלאוט: 'Fallout',
  'מאס אפקט': 'Mass Effect',
  'דראגון אייג׳': 'Dragon Age',
  'בלדורס גייט': "Baldur's Gate",
  'באלדורס גייט': "Baldur's Gate",
  'פיינל פנטזי': 'Final Fantasy',
  פרסונה: 'Persona',
  'דרגון בול': 'Dragon Ball',
  נארוטו: 'Naruto',
  'וואן פיס': 'One Piece',
  'קינגדום הארטס': 'Kingdom Hearts',

  // Shooters and action
  דום: 'Doom',
  וולפנשטיין: 'Wolfenstein',
  ביושוק: 'BioShock',
  בורדרלנדס: 'Borderlands',
  'דד ספייס': 'Dead Space',
  אליאן: 'Alien',
  קונטרול: 'Control',
  'מקס פיין': 'Max Payne',
  פורטל: 'Portal',
  'האלף לייף': 'Half-Life',

  // Indies and family
  'סטארדיו ואלי': 'Stardew Valley',
  'הולו נייט': 'Hollow Knight',
  טרריה: 'Terraria',
  קאפהד: 'Cuphead',
  סלסטה: 'Celeste',
  אנדרטייל: 'Undertale',
  אורי: 'Ori',
  'איט טייקס טו': 'It Takes Two',
  'ליטל נייטמארס': 'Little Nightmares',
  'הסימס': 'The Sims',
  סימס: 'The Sims',
  סיוויליזיישן: 'Civilization',
  'אייג׳ אוף אמפייירס': 'Age of Empires',
  'אייג׳ אוף אמפיירס': 'Age of Empires',
  'סיטיס סקיילינס': 'Cities: Skylines',
  'פוטבול מנג׳ר': 'Football Manager',

  // Licensed
  'מלחמת הכוכבים': 'Star Wars',
  'סטאר וורס': 'Star Wars',
  'שר הטבעות': 'The Lord of the Rings',
  'הארי פוטר': 'Harry Potter',
  'הוגוורטס לגסי': 'Hogwarts Legacy',
  באטמן: 'Batman',
  'ספיידרמן מיילס': 'Spider-Man Miles Morales',
  לגו: 'LEGO',
  'הוביט': 'The Hobbit',
};

/** Longest first, so a two-word franchise beats either of its words. */
const ORDERED = Object.keys(ALIASES).sort((a, b) => {
  const words = b.split(/\s+/).length - a.split(/\s+/).length;
  return words !== 0 ? words : b.length - a.length;
});

/**
 * Hebrew punctuation varies by keyboard: the geresh in "ג׳יטיאיי" may be typed
 * as U+05F3, an apostrophe, or a backtick, and a quote may be a gershayim or a
 * double quote. Normalising them means one dictionary row covers all of them.
 */
function normalise(word: string): string {
  return word
    .replace(/[׳'`’]/g, '׳')
    .replace(/[״"“”]/g, '״')
    .toLowerCase();
}

export interface LatinQuery {
  /** What to actually search for. Empty when nothing could be translated. */
  query: string;
  /** Hebrew phrases that were recognised, for showing the user what happened. */
  matched: string[];
  /** Hebrew words no dictionary entry covered, dropped rather than mangled. */
  dropped: string[];
}

/**
 * Turn a Hebrew query into one the stores can answer.
 *
 * Returns null when there is no Hebrew to translate, so the caller can leave a
 * Latin query completely alone.
 */
export function toLatinQuery(raw: string): LatinQuery | null {
  const text = raw.trim();
  if (!text || !hasHebrew(text)) return null;

  const words = text.split(/\s+/);
  const normalised = words.map(normalise);
  const out: string[] = [];
  const matched: string[] = [];
  const dropped: string[] = [];

  let i = 0;
  while (i < words.length) {
    const word = words[i]!;
    // Anything already Latin (a number, an English word someone mixed in) is
    // passed through untouched — "ספיידרמן 2" must keep its 2.
    if (!hasHebrew(word)) {
      out.push(word);
      i++;
      continue;
    }

    let hit: { alias: string; length: number } | null = null;
    for (const alias of ORDERED) {
      const parts = normalise(alias).split(/\s+/);
      if (i + parts.length > words.length) continue;
      if (parts.every((p, k) => normalised[i + k] === p)) {
        hit = { alias, length: parts.length };
        break;
      }
    }

    if (hit) {
      out.push(ALIASES[hit.alias]!);
      matched.push(words.slice(i, i + hit.length).join(' '));
      i += hit.length;
    } else {
      // Dropped, not transliterated. See this file's header: a letter-by-letter
      // rendering of an unvowelled word matches nothing in any catalogue, and
      // an empty result would look like the game does not exist.
      dropped.push(word);
      i++;
    }
  }

  return { query: out.join(' ').trim(), matched, dropped };
}
