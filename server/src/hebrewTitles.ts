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
  "קול אוף דיוטי בלאק אופס": "Call of Duty Black Ops",
  "קול אוף דיוטי מודרן וורפייר": "Call of Duty Modern Warfare",
  "ברת אוף דה ווילד": "The Legend of Zelda: Breath of the Wild",
  "גארדיאנס אוף דה גלקסי": "Marvel's Guardians of the Galaxy",
  "גוד אוף וור ראגנארוק": "God of War Ragnarok",
  "טירס אוף דה קינגדום": "The Legend of Zelda: Tears of the Kingdom",
  "קול אוף דיוטי וורזון": 'Call of Duty Warzone',
  "רייז אוף דה רונין": "Rise of the Ronin",
  "שדו אוף דה קולוסוס": "Shadow of the Colossus",
  "א פלייג טייל": "A Plague Tale",
  "איט טייקס טו": 'It Takes Two',
  "איי אף סי": 'EA Sports FC',
  "אייג׳ אוף אמפייירס": 'Age of Empires',
  "אייג׳ אוף אמפיירס": 'Age of Empires',
  "אייג׳ אוף מיתולוגיה": "Age of Mythology",
  "אלדן רינג נייטריין": "Elden Ring Nightreign",
  "אן אייץ׳ אל": "NHL",
  "אן בי איי": "NBA 2K",
  "ביונד טו סולס": "Beyond: Two Souls",
  "בק פור בלאד": "Back 4 Blood",
  "גוד אוף וור": 'God of War',
  "גוסט אוף צושימה": 'Ghost of Tsushima',
  "גירס אוף וור": 'Gears of War',
  "גראנד תפט אוטו": 'Grand Theft Auto',
  "גראנד ת׳פט אוטו": "Grand Theft Auto",
  "גרנד תפט אוטו": 'Grand Theft Auto',
  "ג׳י טי איי": "Grand Theft Auto",
  "דארק סולס 3": "Dark Souls 3",
  "דד אור אלייב": "Dead or Alive",
  "הארטס אוף איירון": "Hearts of Iron",
  "הוריזון זירו דאון": "Horizon Zero Dawn",
  "הוריזון פורבידן ווסט": "Horizon Forbidden West",
  "וורלד אוף וורקראפט": 'World of Warcraft',
  "יו אף סי": "UFC",
  "לאסט אוף אס": 'The Last of Us',
  "ליג אוף לג׳נדס": 'League of Legends',
  "לייף איז סטריינג": "Life is Strange",
  "לייק א דרגון": "Like a Dragon",
  "לפט פור דד": "Left 4 Dead",
  "מאונט אנד בלייד": "Mount & Blade",
  "נו מנס סקיי": "No Man's Sky",
  "ניד פור ספיד": 'Need for Speed',
  "סטייט אוף דיקיי": "State of Decay",
  "סטריטס אוף רייג׳": "Streets of Rage",
  "סי אוף ת׳יבס": 'Sea of Thieves',
  "סליי דה ספייר": "Slay the Spire",
  "פילרס אוף אטרניטי": "Pillars of Eternity",
  "קול אוף דיוטי": 'Call of Duty',
  "קומנד אנד קונקר": "Command & Conquer",
  "קומפני אוף היירוז": "Company of Heroes",
  "רד דד רדמפשן": "Red Dead Redemption",
  "ריסק אוף ריין": "Risk of Rain",
  "אאוטר ווילדס": "Outer Wilds",
  "אאוטר וורלדס": "The Outer Worlds",
  "אינדיאנה ג׳ונס": "Indiana Jones",
  "אלדן רינג": 'Elden Ring',
  "אלדר סקרולס": 'The Elder Scrolls',
  "אלייט דיינג׳רס": "Elite Dangerous",
  "אמונג אס": 'Among Us',
  "אמריקן טראק": "American Truck Simulator",
  "אנטיל דון": "Until Dawn",
  "אנימל קרוסינג": 'Animal Crossing',
  "אסאסינס קריד": "Assassin's Creed",
  "אסטו קורסה": "Assetto Corsa",
  "אסטרו בוט": "Astro Bot",
  "אסטרל צ׳יין": "Astral Chain",
  "אססינס קריד": "Assassin's Creed",
  "אף 1": "F1",
  "אפקס לג׳נדס": 'Apex Legends',
  "אקספדישן 33": "Clair Obscur: Expedition 33",
  "ארמורד קור": "Armored Core",
  "באלדורס גייט": "Baldur's Gate",
  "בלאק מית": "Black Myth: Wukong",
  "בלדורס גייט": "Baldur's Gate",
  "גותם נייטס": "Gotham Knights",
  "גילטי גיר": "Guilty Gear",
  "גראן טורימו": 'Gran Turismo',
  "גראן טוריסמו": 'Gran Turismo',
  "גרים פנדנגו": "Grim Fandango",
  "ג׳אסט קאוז": "Just Cause",
  "ג׳ורסיק וורלד": "Jurassic World Evolution",
  "דארק סולס": 'Dark Souls',
  "דד איילנד": "Dead Island",
  "דד סלס": "Dead Cells",
  "דד ספייס": 'Dead Space',
  "דד רייזינג": "Dead Rising",
  "דונט סטארב": "Don't Starve",
  "דונקי קונג": 'Donkey Kong',
  "דייז גון": "Days Gone",
  "דיינג לייט": "Dying Light",
  "דיסקו אליזיום": "Disco Elysium",
  "דיפ רוק": "Deep Rock Galactic",
  "דראגון אייג׳": 'Dragon Age',
  "דרגון בול": 'Dragon Ball',
  "דרגון קווסט": "Dragon Quest",
  "דרגונס דוגמה": "Dragon's Dogma",
  "דת סטרנדינג": 'Death Stranding',
  "האחרון מאיתנו": 'The Last of Us',
  "האלף לייף": 'Half-Life',
  "הארי פוטר": 'Harry Potter',
  "הבי ריין": "Heavy Rain",
  "הוגוורטס לגסי": 'Hogwarts Legacy',
  "הולו נייט": 'Hollow Knight',
  "ואמפייר סרווייברס": "Vampire Survivors",
  "וואן פיס": 'One Piece',
  "ווטש דוגס": 'Watch Dogs',
  "ווקינג דד": "The Walking Dead",
  "טוטאל וור": "Total War",
  "טומב ריידר": 'Tomb Raider',
  "טוני הוק": "Tony Hawk",
  "טיילס אוף": "Tales of",
  "יורו טראק": "Euro Truck Simulator",
  "לאסט גארדיאן": "The Last Guardian",
  "ליטל נייטמארס": 'Little Nightmares',
  "לתאל קומפני": "Lethal Company",
  "מאנקי איילנד": "Monkey Island",
  "מאס אפקט": 'Mass Effect',
  "מגה מן": "Mega Man",
  "מונסטר האנטר": "Monster Hunter",
  "מורטל קומבט": 'Mortal Kombat',
  "מטאל גיר": 'Metal Gear',
  "מידנייט סאנס": "Marvel's Midnight Suns",
  "מלחמת הכוכבים": 'Star Wars',
  "מקס פיין": 'Max Payne',
  "מריו סטרייקרס": "Mario Strikers",
  "מריו פארטי": "Mario Party",
  "מריו קארט": 'Mario Kart',
  "ניר אוטומטה": "NieR: Automata",
  "סוויסייד סקווד": "Suicide Squad",
  "סול קליבר": "Soulcalibur",
  "סופר מריו": 'Super Mario',
  "סטאר וורס": 'Star Wars',
  "סטאר סיטיזן": "Star Citizen",
  "סטארדיו ואלי": 'Stardew Valley',
  "סטלר בלייד": "Stellar Blade",
  "סטריט פייטר": 'Street Fighter',
  "סיטיס סקיילינס": 'Cities: Skylines',
  "סייברפאנק 2077": "Cyberpunk 2077",
  "סיילנט היל": 'Silent Hill',
  "סיינטס רואו": "Saints Row",
  "סליפינג דוגס": "Sleeping Dogs",
  "סמאש ברוס": 'Super Smash Bros',
  "ספיידר מן": 'Spider-Man',
  "ספיידרמן 2": "Spider-Man 2",
  "ספיידרמן מיילס": 'Spider-Man Miles Morales',
  "ספייס מרין": "Warhammer 40,000: Space Marine",
  "עולם היורה": "Jurassic World Evolution",
  "פאפרס פליז": "Papers, Please",
  "פאר קריי": 'Far Cry',
  "פארמינג סימולייטור": "Farming Simulator",
  "פוטבול מנג׳ר": 'Football Manager',
  "פול גאיז": 'Fall Guys',
  "פורמולה 1": "F1",
  "פיינל פנטזי": 'Final Fantasy',
  "פייפר מריו": "Paper Mario",
  "פייר אמבלם": 'Fire Emblem',
  "פלייט סימולייטור": "Microsoft Flight Simulator",
  "קאונטר סטרייק": 'Counter-Strike',
  "קור קיפר": "Core Keeper",
  "קינגדום הארטס": 'Kingdom Hearts',
  "קינגדום קאם": "Kingdom Come: Deliverance",
  "קלייר אובסקיור": "Clair Obscur: Expedition 33",
  "קרוסיידר קינגס": "Crusader Kings",
  "רד אלרט": "Command & Conquer Red Alert",
  "רד דד": 'Red Dead Redemption',
  "רוקט ליג": 'Rocket League',
  "רזידנט איויל": 'Resident Evil',
  "רינג פיט": "Ring Fit Adventure",
  "שובל נייט": "Shovel Knight",
  "שר הטבעות": 'The Lord of the Rings',
  "אאוטלאוס": "Star Wars Outlaws",
  "אאוטלאסט": "Outlast",
  "אדישן": 'Edition',
  "אוברווטש": 'Overwatch',
  "אווווד": "Avowed",
  "אווטאר": "Avatar: Frontiers of Pandora",
  "אוונג׳רס": "Marvel's Avengers",
  "אולטימט": 'Ultimate',
  "אוף": 'of',
  "אורי": 'Ori',
  "אין": 'in',
  "אינסייד": "INSIDE",
  "אינפיימוס": "inFAMOUS",
  "איפוטבול": "eFootball",
  "אליאן": 'Alien',
  "אמנזיה": "Amnesia",
  "אנבייאיי": "NBA 2K",
  "אנד": 'and',
  "אנדרטייל": 'Undertale',
  "אנו": "Anno",
  "אנצארטד": 'Uncharted',
  "אנצ׳רטד": 'Uncharted',
  "אנשארטד": "Uncharted",
  "אקסקום": "XCOM",
  "ארק": "ARK",
  "באטלפילד": 'Battlefield',
  "באטלפרונט": "Star Wars Battlefront",
  "באטמן": 'Batman',
  "באלאטרו": "Balatro",
  "בורדרלנדס": 'Borderlands',
  "ביושוק": 'BioShock',
  "בייונטה": "Bayonetta",
  "בלאדבורן": 'Bloodborne',
  "בלאספמוס": "Blasphemous",
  "ברייד": "Braid",
  "גולד": 'Gold',
  "גיטיאיי": 'Grand Theft Auto',
  "גריס": "GRIS",
  "ג׳די": "Star Wars Jedi",
  "ג׳יטיאיי": 'Grand Theft Auto',
  "ג׳נשין": "Genshin Impact",
  "ג׳רני": "Journey",
  "דארקטייד": "Darktide",
  "דדלופ": "Deathloop",
  "דה": 'the',
  "דוטה": 'Dota',
  "דום": 'Doom',
  "דיאבלו": 'Diablo',
  "דיוויניטי": "Divinity",
  "דיון": "Dune",
  "דיטרויט": "Detroit: Become Human",
  "דירט": "DiRT",
  "דישונורד": "Dishonored",
  "דלוקס": 'Deluxe',
  "דפיניטיב": 'Definitive',
  "הוביט": 'The Hobbit',
  "הוויצ׳ר": 'The Witcher',
  "הויצר": 'The Witcher',
  "הונקאי": "Honkai",
  "הוריזון": 'Horizon',
  "היטמן": 'Hitman',
  "היידס": "Hades",
  "היילו": 'Halo',
  "הילו": 'Halo',
  "הלדייברס": "Helldivers",
  "הסימס": 'The Sims',
  "וויסטלנד": "Wasteland",
  "וולברין": "Marvel's Wolverine",
  "וולפנשטיין": 'Wolfenstein',
  "ווקונג": "Black Myth: Wukong",
  "וורהאמר": "Warhammer",
  "ווריו": "Wario",
  "וורקראפט": 'Warcraft',
  "ויצר": "The Witcher",
  "ויצ׳ר": 'The Witcher',
  "ולהיים": "Valheim",
  "ולורנט": 'Valorant',
  "ורמינטייד": "Vermintide",
  "זלדה": 'Zelda',
  "זנלס": "Zenless Zone Zero",
  "טקן": 'Tekken',
  "טרופיקו": "Tropico",
  "טרנספורמרס": "Transformers",
  "טרריה": 'Terraria',
  "יאקוזה": "Yakuza",
  "יושי": "Yoshi",
  "לגו": 'LEGO',
  "לואיג׳י": "Luigi's Mansion",
  "לימבו": "LIMBO",
  "מאדן": "Madden NFL",
  "מאפיה": "Mafia",
  "מטרואיד": 'Metroid',
  "מיינקראפט": 'Minecraft',
  "מרוול": "Marvel",
  "מריו": 'Mario',
  "נארוטו": 'Naruto',
  "ניר": "NieR",
  "סאבנוטיקה": "Subnautica",
  "סאקבוי": "Sackboy",
  "סוניק": 'Sonic',
  "סטארפילד": 'Starfield',
  "סטארקראפט": 'StarCraft',
  "סטלריס": "Stellaris",
  "סטריי": "Stray",
  "סיוויליזיישן": 'Civilization',
  "סייברפאנק": 'Cyberpunk 2077',
  "סייקנוטס": "Psychonauts",
  "סילקסונג": "Hollow Knight: Silksong",
  "סימס": 'The Sims',
  "סלסטה": 'Celeste',
  "סנואוראנר": "SnowRunner",
  "ספיידרמן": 'Spider-Man',
  "ספלטון": 'Splatoon',
  "סקוודרונס": "Star Wars: Squadrons",
  "סקייט": "Skate",
  "סקיירים": 'Skyrim',
  "סקירו": 'Sekiro',
  "פאלאוט": 'Fallout',
  "פאלוורלד": "Palworld",
  "פאתפיינדר": "Pathfinder",
  "פובג": "PUBG",
  "פוקימון": 'Pokemon',
  "פורזה": 'Forza',
  "פורטל": 'Portal',
  "פורטנייט": 'Fortnite',
  "פייבל": "Fable",
  "פייידיי": "PAYDAY",
  "פיפא": 'FIFA',
  "פיפ״א": 'FIFA',
  "פיקמין": "Pikmin",
  "פקטוריו": "Factorio",
  "פרוסטפאנק": "Frostpunk",
  "פרסונה": 'Persona',
  "קאפהד": 'Cuphead',
  "קומפליט": 'Complete',
  "קונטרה": "Contra",
  "קונטרול": 'Control',
  "קילזון": "Killzone",
  "קירבי": 'Kirby',
  "קסטלווניה": "Castlevania",
  "קסניובלייד": 'Xenoblade',
  "קרבל": "Kerbal Space Program",
  "ראסט": "Rust",
  "רובלוקס": "Roblox",
  "רטרנל": "Returnal",
  "רטשט": 'Ratchet & Clank',
  "ריזיסטנס": "Resistance",
  "רימאסטר": 'Remastered',
  "רימאסטרד": 'Remastered',
  "רימוורלד": "RimWorld",
  "רימייק": 'Remake',
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
