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
  "אורי אנד דה בליינד פורסט": "Ori and the Blind Forest",
  "קול אוף דיוטי בלאק אופס": "Call of Duty Black Ops",
  "קול אוף דיוטי מודרן וורפייר": "Call of Duty Modern Warfare",
  "אורי אנד דה ויספס": "Ori and the Will of the Wisps",
  "ביונד גוד אנד איוול": "Beyond Good and Evil",
  "ברת אוף דה ווילד": "The Legend of Zelda: Breath of the Wild",
  "גארדיאנס אוף דה גלקסי": "Marvel's Guardians of the Galaxy",
  "גוד אוף וור ראגנארוק": "God of War Ragnarok",
  "טירס אוף דה קינגדום": "The Legend of Zelda: Tears of the Kingdom",
  "לורדס אוף דה פולן": "Lords of the Fallen",
  "מאונט אנד בלייד 2": "Mount & Blade II",
  "קאלט אוף דה לאמב": "Cult of the Lamb",
  "קול אוף דיוטי וורזון": "Call of Duty Warzone",
  "רייז אוף דה רונין": "Rise of the Ronin",
  "שדו אוף דה קולוסוס": "Shadow of the Colossus",
  "א פלייג טייל": "A Plague Tale",
  "אוקסיג׳ן נוט אינקלודד": "Oxygen Not Included",
  "איט טייקס טו": "It Takes Two",
  "איי אף סי": "EA Sports FC",
  "אייג׳ אוף אמפייירס": "Age of Empires",
  "אייג׳ אוף אמפייר": "Age of Empires",
  "אייג׳ אוף אמפיירס": "Age of Empires",
  "אייג׳ אוף וונדרס": "Age of Wonders",
  "אייג׳ אוף מיתולוגיה": "Age of Mythology",
  "אלדן רינג נייטריין": "Elden Ring Nightreign",
  "אלדר סקרולס אונליין": "The Elder Scrolls Online",
  "אן אייץ׳ אל": "NHL",
  "אן בי איי": "NBA 2K",
  "אנטר דה גנג׳ן": "Enter the Gungeon",
  "ביונד טו סולס": "Beyond: Two Souls",
  "בינדינג אוף אייזק": "The Binding of Isaac",
  "בק פור בלאד": "Back 4 Blood",
  "גוד אוף וור": "God of War",
  "גוסט אוף יוטיי": "Ghost of Yotei",
  "גוסט אוף צושימה": "Ghost of Tsushima",
  "גירס אוף וור": "Gears of War",
  "גראנד תפט אוטו": "Grand Theft Auto",
  "גראנד ת׳פט אוטו": "Grand Theft Auto",
  "גרנד תפט אוטו": "Grand Theft Auto",
  "ג׳י טי איי": "Grand Theft Auto",
  "דארק סולס 3": "Dark Souls 3",
  "דד אור אלייב": "Dead or Alive",
  "דד ביי דיילייט": "Dead by Daylight",
  "דוויל מיי קריי": "Devil May Cry",
  "דונט סטארב טוגדר": "Don't Starve Together",
  "דיינג לייט 2": "Dying Light 2",
  "הארטס אוף איירון": "Hearts of Iron",
  "הוריזון זירו דאון": "Horizon Zero Dawn",
  "הוריזון פורבידן ווסט": "Horizon Forbidden West",
  "היי פיי ראש": "Hi-Fi Rush",
  "וורלד אוף וורקראפט": "World of Warcraft",
  "וורלד אוף וורשיפס": "World of Warships",
  "וורלד אוף טאנקס": "World of Tanks",
  "טיילס אוף אררייז": "Tales of Arise",
  "יו אף סי": "UFC",
  "לאסט אוף אס": "The Last of Us",
  "ליג אוף לג׳נדס": "League of Legends",
  "לייארס אוף פיר": "Layers of Fear",
  "לייז אוף פי": "Lies of P",
  "לייף איז סטריינג": "Life is Strange",
  "לייק א דרגון": "Like a Dragon",
  "לפט פור דד": "Left 4 Dead",
  "מאונט אנד בלייד": "Mount & Blade",
  "מגה מן איקס": "Mega Man X",
  "מדל אוף אונור": "Medal of Honor",
  "מונסטר האנטר וילדס": "Monster Hunter Wilds",
  "נו מנס סקיי": "No Man's Sky",
  "ניד פור ספיד": "Need for Speed",
  "סטייט אוף דיקיי": "State of Decay",
  "סטריט פייטר 6": "Street Fighter 6",
  "סטריטס אוף רייג׳": "Streets of Rage",
  "סי אוף ת׳יבס": "Sea of Thieves",
  "סליי דה ספייר": "Slay the Spire",
  "פיינל פנטזי 14": "Final Fantasy XIV",
  "פיינל פנטזי 16": "Final Fantasy XVI",
  "פילרס אוף אטרניטי": "Pillars of Eternity",
  "פרינס אוף פרשה": "Prince of Persia",
  "קול אוף דיוטי": "Call of Duty",
  "קומנד אנד קונקר": "Command & Conquer",
  "קומפני אוף היירוז": "Company of Heroes",
  "רד דד רדמפשן": "Red Dead Redemption",
  "רולר קוסטר טייקון": "RollerCoaster Tycoon",
  "רומא טוטאל וור": "Total War: Rome",
  "ריסק אוף ריין": "Risk of Rain",
  "ת׳יי אר ביליונס": "They Are Billions",
  "אאוויל וויתין": "The Evil Within",
  "אאוטר ווילדס": "Outer Wilds",
  "אאוטר וורלדס": "The Outer Worlds",
  "אדבנס וורס": "Advance Wars",
  "אדית פינץ׳": "What Remains of Edith Finch",
  "אוברה דין": "Return of the Obra Dinn",
  "אוברווטש 2": "Overwatch 2",
  "איב אונליין": "EVE Online",
  "אייס אטורני": "Ace Attorney",
  "אינדיאנה ג׳ונס": "Indiana Jones",
  "אלדן רינג": "Elden Ring",
  "אלדר סקרולס": "The Elder Scrolls",
  "אלייט דיינג׳רס": "Elite Dangerous",
  "אמונג אס": "Among Us",
  "אמריקן טראק": "American Truck Simulator",
  "אנו 1800": "Anno 1800",
  "אנטיל דון": "Until Dawn",
  "אנימל וול": "Animal Well",
  "אנימל קרוסינג": "Animal Crossing",
  "אסאסינס קריד": "Assassin's Creed",
  "אסטו קורסה": "Assetto Corsa",
  "אסטרו בוט": "Astro Bot",
  "אסטרל צ׳יין": "Astral Chain",
  "אססינס קריד": "Assassin's Creed",
  "אסקייפ מטרקוב": "Escape from Tarkov",
  "אף 1": "F1",
  "אפקס לג׳נדס": "Apex Legends",
  "אקסיום וורג׳": "Axiom Verge",
  "אקספדישן 33": "Clair Obscur: Expedition 33",
  "ארמורד קור": "Armored Core",
  "באלדורס גייט": "Baldur's Gate",
  "בלאק דזרט": "Black Desert",
  "בלאק מית": "Black Myth: Wukong",
  "בלדורס גייט": "Baldur's Gate",
  "בלו פרינס": "Blue Prince",
  "גולדן סאן": "Golden Sun",
  "גון הום": "Gone Home",
  "גוסט ריקון": "Ghost Recon",
  "גותם נייטס": "Gotham Knights",
  "גילד וורס": "Guild Wars",
  "גילטי גיר": "Guilty Gear",
  "גראן טוריזמו": "Gran Turismo",
  "גראן טורימו": "Gran Turismo",
  "גראן טוריסמו": "Gran Turismo",
  "גרים פנדנגו": "Grim Fandango",
  "ג׳אסט קאוז": "Just Cause",
  "ג׳ורסיק וורלד": "Jurassic World Evolution",
  "ג׳ק ודקסטר": "Jak and Daxter",
  "דארק סולס": "Dark Souls",
  "דד איילנד": "Dead Island",
  "דד סלס": "Dead Cells",
  "דד ספייס": "Dead Space",
  "דד רייזינג": "Dead Rising",
  "דה פיינלס": "The Finals",
  "דום איטרנל": "DOOM Eternal",
  "דונט סטארב": "Don't Starve",
  "דונקי קונג": "Donkey Kong",
  "דיטקטיב פיקאצ׳ו": "Detective Pikachu",
  "דייב הדייבר": "Dave the Diver",
  "דייז גון": "Days Gone",
  "דיינג לייט": "Dying Light",
  "דיסקו אליזיום": "Disco Elysium",
  "דיפ רוק": "Deep Rock Galactic",
  "דלתא פורס": "Delta Force",
  "דמון סולס": "Demon's Souls",
  "דסטיני 2": "Destiny 2",
  "דראגון אייג׳": "Dragon Age",
  "דרגון אייג׳": "Dragon Age",
  "דרגון בול": "Dragon Ball",
  "דרגון קווסט": "Dragon Quest",
  "דרגונס דוגמה": "Dragon's Dogma",
  "דת סטרנדינג": "Death Stranding",
  "האחרון מאיתנו": "The Last of Us",
  "האלף לייף": "Half-Life",
  "האנט שואודאון": "Hunt Showdown",
  "הארי פוטר": "Harry Potter",
  "הבי ריין": "Heavy Rain",
  "הוגוורטס לגסי": "Hogwarts Legacy",
  "הולו נייט": "Hollow Knight",
  "היידס 2": "Hades II",
  "ואמפייר סרווייברס": "Vampire Survivors",
  "וו לונג": "Wo Long",
  "וואן פיס": "One Piece",
  "ווטש דוגס": "Watch Dogs",
  "ווקינג דד": "The Walking Dead",
  "וור ת׳אנדר": "War Thunder",
  "זו טייקון": "Zoo Tycoon",
  "טו פוינט": "Two Point Hospital",
  "טוויסטד מטאל": "Twisted Metal",
  "טוטאל ווארהאמר": "Total War: Warhammer",
  "טוטאל וור": "Total War",
  "טומב ריידר": "Tomb Raider",
  "טוני הוק": "Tony Hawk",
  "טופ ספין": "TopSpin",
  "טיילס אוף": "Tales of",
  "טים פורטרס": "Team Fortress",
  "טיני טינה": "Tiny Tina's Wonderlands",
  "טריאנגל סטרטג׳י": "Triangle Strategy",
  "יוניקורן אוברלורד": "Unicorn Overlord",
  "יורו טראק": "Euro Truck Simulator",
  "כרונו טריגר": "Chrono Trigger",
  "לאסט גארדיאן": "The Last Guardian",
  "לוסט ארק": "Lost Ark",
  "ליטל נייטמארס": "Little Nightmares",
  "ליטל נייטמרס": "Little Nightmares",
  "לתאל קומפני": "Lethal Company",
  "מאנקי איילנד": "Monkey Island",
  "מאס אפקט": "Mass Effect",
  "מארוול ריוולס": "Marvel Rivals",
  "מגה מן": "Mega Man",
  "מוטו ג׳יפי": "MotoGP",
  "מונסטר האנטר": "Monster Hunter",
  "מורטל קומבט": "Mortal Kombat",
  "מטאל גיר": "Metal Gear",
  "מידנייט סאנס": "Marvel's Midnight Suns",
  "מלחמת הכוכבים": "Star Wars",
  "מקס פיין": "Max Payne",
  "מריו אודיסיי": "Super Mario Odyssey",
  "מריו וונדר": "Super Mario Bros Wonder",
  "מריו סטרייקרס": "Mario Strikers",
  "מריו פארטי": "Mario Party",
  "מריו קארט": "Mario Kart",
  "נוקליר ת׳רון": "Nuclear Throne",
  "ניו וורלד": "New World",
  "ניר אוטומטה": "NieR: Automata",
  "סאות פארק": "South Park",
  "סוויסייד סקווד": "Suicide Squad",
  "סול קליבר": "Soulcalibur",
  "סופר מריו": "Super Mario",
  "סופרים קומנדר": "Supreme Commander",
  "סטאר וורס": "Star Wars",
  "סטאר סיטיזן": "Star Citizen",
  "סטארדיו ואלי": "Stardew Valley",
  "סטלר בלייד": "Stellar Blade",
  "סטריט פייטר": "Street Fighter",
  "סיטיז סקיילינס": "Cities: Skylines",
  "סיטיס סקיילינס": "Cities: Skylines",
  "סייברפאנק 2077": "Cyberpunk 2077",
  "סיילנט היל": "Silent Hill",
  "סיינטס רואו": "Saints Row",
  "סים סיטי": "SimCity",
  "סיסטם שוק": "System Shock",
  "סלי קופר": "Sly Cooper",
  "סליפינג דוגס": "Sleeping Dogs",
  "סמאש ברוס": "Super Smash Bros",
  "ספיידר מן": "Spider-Man",
  "ספיידרמן 2": "Spider-Man 2",
  "ספיידרמן מיילס": "Spider-Man Miles Morales",
  "ספייס מרין": "Warhammer 40,000: Space Marine",
  "ספלינטר סל": "Splinter Cell",
  "עולם היורה": "Jurassic World Evolution",
  "פאינל פנטזי": "Final Fantasy",
  "פאפרס פליז": "Papers, Please",
  "פאר קריי": "Far Cry",
  "פארמינג סימולייטור": "Farming Simulator",
  "פוטבול מנג׳ר": "Football Manager",
  "פול גאיז": "Fall Guys",
  "פוקימון ויולט": "Pokemon Violet",
  "פוקימון לג׳נדס": "Pokemon Legends",
  "פוקימון סקרלט": "Pokemon Scarlet",
  "פורזה הוריזון": "Forza Horizon",
  "פורזה מוטורספורט": "Forza Motorsport",
  "פורמולה 1": "F1",
  "פייב נייטס": "Five Nights at Freddy's",
  "פיינל פנטזי": "Final Fantasy",
  "פייפר מריו": "Paper Mario",
  "פייר אמבלם": "Fire Emblem",
  "פיניקס רייט": "Phoenix Wright",
  "פיפא 24": "EA Sports FC 24",
  "פיפא 25": "EA Sports FC 25",
  "פיצה טאוור": "Pizza Tower",
  "פלאנט זו": "Planet Zoo",
  "פלאנט קוסטר": "Planet Coaster",
  "פלייט סימולייטור": "Microsoft Flight Simulator",
  "פרוג׳קט קארס": "Project CARS",
  "פרוסטפאנק 2": "Frostpunk 2",
  "פרסונה 5": "Persona 5",
  "קאונטר סטרייק": "Counter-Strike",
  "קור קיפר": "Core Keeper",
  "קייב סטורי": "Cave Story",
  "קינגדום הארטס": "Kingdom Hearts",
  "קינגדום קאם": "Kingdom Come: Deliverance",
  "קלייר אובסקיור": "Clair Obscur: Expedition 33",
  "קרוסיידר קינגס": "Crusader Kings",
  "רד אלרט": "Command & Conquer Red Alert",
  "רד דד": "Red Dead Redemption",
  "רוג לגסי": "Rogue Legacy",
  "רוח צושימה": "Ghost of Tsushima",
  "רוקט ליג": "Rocket League",
  "רזידנט איוויל": "Resident Evil",
  "רזידנט איויל": "Resident Evil",
  "ריזידנט איוויל": "Resident Evil",
  "ריינבו סיקס": "Rainbow Six",
  "רינג פיט": "Ring Fit Adventure",
  "שובל נייט": "Shovel Knight",
  "שין מגאמי": "Shin Megami Tensei",
  "שר הטבעות": "The Lord of the Rings",
  "אאוטלאוס": "Star Wars Outlaws",
  "אאוטלאסט": "Outlast",
  "אבזו": "ABZU",
  "אדישן": "Edition",
  "אוברווטש": "Overwatch",
  "אווווד": "Avowed",
  "אווטאר": "Avatar: Frontiers of Pandora",
  "אוונג׳רס": "Marvel's Avengers",
  "אולטימט": "Ultimate",
  "אוף": "of",
  "אוקאמי": "Okami",
  "אוקטופאת": "Octopath Traveler",
  "אורי": "Ori",
  "אייפקס": "Apex Legends",
  "אין": "in",
  "אינסייד": "INSIDE",
  "אינסרג׳נסי": "Insurgency",
  "אינפיימוס": "inFAMOUS",
  "איפוטבול": "eFootball",
  "אלביון": "Albion Online",
  "אליאן": "Alien",
  "אמנזיה": "Amnesia",
  "אנבייאיי": "NBA 2K",
  "אנד": "and",
  "אנדרטייל": "Undertale",
  "אנו": "Anno",
  "אנצארטד": "Uncharted",
  "אנצ׳רטד": "Uncharted",
  "אנשארטד": "Uncharted",
  "אקסקום": "XCOM",
  "ארמה": "Arma",
  "ארק": "ARK",
  "באטלפילד": "Battlefield",
  "באטלפרונט": "Star Wars Battlefront",
  "באטמן": "Batman",
  "באלאטרו": "Balatro",
  "בורדרלנדס": "Borderlands",
  "בורנאאוט": "Burnout",
  "בטלפילד": "Battlefield",
  "ביושוק": "BioShock",
  "בייונטה": "Bayonetta",
  "בלאדבורן": "Bloodborne",
  "בלאספמוס": "Blasphemous",
  "בסטיון": "Bastion",
  "בראבלי": "Bravely Default",
  "ברייד": "Braid",
  "גולד": "Gold",
  "גיטיאיי": "Grand Theft Auto",
  "גראונדד": "Grounded",
  "גריס": "GRIS",
  "ג׳די": "Star Wars Jedi",
  "ג׳יטיאיי": "Grand Theft Auto",
  "ג׳נשין": "Genshin Impact",
  "ג׳רני": "Journey",
  "דארקטייד": "Darktide",
  "דדלופ": "Deathloop",
  "דה": "the",
  "דוטה": "Dota",
  "דום": "Doom",
  "דיאבלו": "Diablo",
  "דיוויז׳ן": "The Division",
  "דיוויניטי": "Divinity",
  "דיון": "Dune",
  "דיטרויט": "Detroit: Become Human",
  "דירט": "DiRT",
  "דישונורד": "Dishonored",
  "דלוקס": "Deluxe",
  "דלטארון": "Deltarune",
  "דסטיני": "Destiny",
  "דפיניטיב": "Definitive",
  "הארת׳סטון": "Hearthstone",
  "הוביט": "The Hobbit",
  "הוויצ׳ר": "The Witcher",
  "הויצר": "The Witcher",
  "הומוורלד": "Homeworld",
  "הונקאי": "Honkai",
  "הוריזון": "Horizon",
  "היטמן": "Hitman",
  "היידס": "Hades",
  "היילו": "Halo",
  "הילו": "Halo",
  "הלדייברס": "Helldivers",
  "הסימס": "The Sims",
  "וויסטלנד": "Wasteland",
  "וולברין": "Marvel's Wolverine",
  "וולפנשטיין": "Wolfenstein",
  "ווקונג": "Black Myth: Wukong",
  "וורהאמר": "Warhammer",
  "וורזון": "Call of Duty Warzone",
  "ווריו": "Wario",
  "וורמס": "Worms",
  "וורפריים": "Warframe",
  "וורקראפט": "Warcraft",
  "ויזאז׳": "Visage",
  "ויצר": "The Witcher",
  "ויצ׳ר": "The Witcher",
  "ולהיים": "Valheim",
  "ולורנט": "Valorant",
  "ורמינטייד": "Vermintide",
  "זלדה": "Zelda",
  "זנובלייד": "Xenoblade",
  "זנלס": "Zenless Zone Zero",
  "טוניק": "TUNIC",
  "טיטאנפול": "Titanfall",
  "טנצ׳ו": "Tenchu",
  "טקן": "Tekken",
  "טרופיקו": "Tropico",
  "טרנזיסטור": "Transistor",
  "טרנספורמרס": "Transformers",
  "טרקמניה": "Trackmania",
  "טרריה": "Terraria",
  "יאקוזה": "Yakuza",
  "יושי": "Yoshi",
  "לגו": "LEGO",
  "לואיג׳י": "Luigi's Mansion",
  "לימבו": "LIMBO",
  "מאדן": "Madden NFL",
  "מאפיה": "Mafia",
  "מאשינריום": "Machinarium",
  "מדיאוויל": "MediEvil",
  "מטאפור": "Metaphor: ReFantazio",
  "מטרואיד": "Metroid",
  "מיינקראפט": "Minecraft",
  "מרוול": "Marvel",
  "מריו": "Mario",
  "נארוטו": "Naruto",
  "נואיטה": "Noita",
  "ניוה": "Nioh",
  "ניר": "NieR",
  "סאבנוטיקה": "Subnautica",
  "סאקבוי": "Sackboy",
  "סוניק": "Sonic",
  "סופרלימינל": "Superliminal",
  "סטארפילד": "Starfield",
  "סטארקראפט": "StarCraft",
  "סטלריס": "Stellaris",
  "סטרונגהולד": "Stronghold",
  "סטריי": "Stray",
  "סיגנליס": "Signalis",
  "סיוויליזיישן": "Civilization",
  "סייברפאנק": "Cyberpunk 2077",
  "סייקנוטס": "Psychonauts",
  "סילקסונג": "Hollow Knight: Silksong",
  "סימס": "The Sims",
  "סלסטה": "Celeste",
  "סנדלנד": "Sand Land",
  "סנואוראנר": "SnowRunner",
  "ספיידרמן": "Spider-Man",
  "ספיריטפארר": "Spiritfarer",
  "ספלטון": "Splatoon",
  "ספלנקי": "Spelunky",
  "סקוואד": "Squad",
  "סקוודרונס": "Star Wars: Squadrons",
  "סקייט": "Skate",
  "סקיירים": "Skyrim",
  "סקירו": "Sekiro",
  "פאלאוט": "Fallout",
  "פאלוורלד": "Palworld",
  "פארקריי": "Far Cry",
  "פאתפיינדר": "Pathfinder",
  "פובג": "PUBG",
  "פוקימון": "Pokemon",
  "פורזה": "Forza",
  "פורטל": "Portal",
  "פורטנייט": "Fortnite",
  "פזמופוביה": "Phasmophobia",
  "פייבל": "Fable",
  "פייידיי": "PAYDAY",
  "פייר": "Pyre",
  "פיירווטש": "Firewatch",
  "פיפא": "FIFA",
  "פיפ״א": "FIFA",
  "פיקמין": "Pikmin",
  "פנאף": "Five Nights at Freddy's",
  "פנטימנט": "Pentiment",
  "פסיכונאוטס": "Psychonauts",
  "פקטוריו": "Factorio",
  "פרוסטפאנק": "Frostpunk",
  "פרסונה": "Persona",
  "ציוויליזציה": "Civilization",
  "קאפהד": "Cuphead",
  "קווייק": "Quake",
  "קומפליט": "Complete",
  "קונטרה": "Contra",
  "קונטרול": "Control",
  "קילזון": "Killzone",
  "קירבי": "Kirby",
  "קסטלווניה": "Castlevania",
  "קסניובלייד": "Xenoblade",
  "קרבל": "Kerbal Space Program",
  "קרייסיס": "Crysis",
  "ראנסקייפ": "RuneScape",
  "ראסט": "Rust",
  "רובלוקס": "Roblox",
  "רטצ׳ט": "Ratchet & Clank",
  "רטרנל": "Returnal",
  "רטשט": "Ratchet & Clank",
  "ריזיסטנס": "Resistance",
  "רימאסטר": "Remastered",
  "רימאסטרד": "Remastered",
  "רימוורלד": "RimWorld",
  "רימייק": "Remake",
  "רמנאנט": "Remnant",
  "רקפסט": "Wreckfest",
  "שוגון": "Total War: Shogun",
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
