/**
 * Freeze a real run of the tool into a snapshot the static demo can serve.
 *
 * The public demo lives on GitHub Pages, which serves files and nothing else —
 * no Node process, so no SQLite, no scraping, no sixteen-source fan-out. Rather
 * than fake the data (a demo that invents prices is a lie about what the tool
 * found), this drives the REAL server exactly the way the browser does and
 * records every answer.
 *
 * It is INCREMENTAL by necessity, not for convenience. One title costs each
 * Israeli shop roughly three requests, and the tool holds itself to 200 per shop
 * per day; capturing sixty in one sitting would spend Player1's entire daily
 * allowance and then quietly record the rest of the catalogue without it. So
 * each run tops up the existing snapshot with whatever is missing or stale, and
 * the library grows over a few days instead of being taken all at once.
 *
 *   node web/demo/capture.mjs                 # top up: stale and missing titles
 *   node web/demo/capture.mjs --limit 12      # a bounded batch
 *   node web/demo/capture.mjs --fresh         # start over, ignoring what exists
 *   node web/demo/capture.mjs --only "Elden Ring,Hades"
 */
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.VGPT_API ?? 'http://localhost:5174';
const OUT_DIR = path.join(import.meta.dirname, 'public');
const OUT = path.join(OUT_DIR, 'snapshot.json');

/**
 * The shop window: sixty titles chosen for VARIETY, not popularity.
 *
 * A demo full of the same kind of game proves only that one kind works. This
 * spreads across PC-only and console-only, physical stock the Israeli shops
 * actually carry, games with heavy add-on catalogues, deep sales, and small
 * indies whose prices behave nothing like a AAA release.
 */
const SEEDS = [
  // Multi-platform AAA — the case everything must handle.
  'Elden Ring', 'God of War Ragnarok', 'Cyberpunk 2077', 'Hogwarts Legacy',
  'Far Cry 6', 'Borderlands 4', "Baldur's Gate 3", 'Red Dead Redemption 2',
  'The Witcher 3 Wild Hunt', 'Grand Theft Auto V', 'Assassins Creed Mirage',
  'Star Wars Jedi Survivor', 'Resident Evil 4', 'Diablo IV', 'Alan Wake 2',
  "Dragon's Dogma 2", 'Final Fantasy VII Rebirth', 'Ghost of Tsushima',
  'Horizon Forbidden West', 'The Last of Us Part I', 'Death Stranding',
  // Big catalogues of add-ons — what the DLC panel is for.
  'The Sims 4', 'Cities Skylines II', 'Total War Warhammer III',
  'Sid Meier’s Civilization VI', 'Farming Simulator 22', 'Euro Truck Simulator 2',
  'Train Simulator', 'Crusader Kings III', 'Stellaris',
  // Fighting, sport and racing — annual releases, steep discounts.
  'Street Fighter 6', 'Tekken 8', 'Mortal Kombat 1', 'EA SPORTS FC 25',
  'NBA 2K25', 'F1 24', 'Forza Horizon 5', 'Gran Turismo 7',
  // Console-first, where the Israeli shops stock discs.
  'The Legend of Zelda Tears of the Kingdom', 'Mario Kart 8 Deluxe',
  'Super Mario Odyssey', 'Metroid Dread', 'Splatoon 3', 'Pokemon Scarlet',
  'Super Smash Bros Ultimate', 'Animal Crossing New Horizons',
  "Marvel's Spider-Man 2", 'Astro Bot',
  // Indies and long-tail — prices that behave nothing like a AAA release.
  'Hollow Knight Silksong', 'Stardew Valley', 'Hades II', 'Celeste',
  'Disco Elysium', 'Divinity Original Sin 2', 'No Man’s Sky', 'Subnautica',
  'Valheim', 'It Takes Two', 'Cuphead', 'Terraria',
];

/**
 * Titles worth recording an add-on search for.
 *
 * Every seed would double the cost for nothing: most games have no add-ons, and
 * the panel only needs enough real examples to show what it does.
 */
const DLC_SEEDS = new Set([
  'Far Cry 6', 'Cyberpunk 2077', 'The Sims 4', 'Cities Skylines II',
  'Total War Warhammer III', 'Sid Meier’s Civilization VI', 'Crusader Kings III',
  'Stellaris', 'Elden Ring', 'Hogwarts Legacy', 'Euro Truck Simulator 2',
  'Borderlands 4',
]);

/** Prefixes of the seeds, so the autocomplete has something to answer with. */
function prefixesOf(title) {
  const out = new Set();
  const clean = title.toLowerCase();
  for (let n = 3; n <= Math.min(clean.length, 12); n++) out.add(clean.slice(0, n).trim());
  return [...out].filter((p) => p.length >= 3);
}

/** Cap the work per title: a search fans out to sixteen stores, and so does every board. */
const MAX_GROUPS = 3;
/** Add-on boards are a sample, not a catalogue. */
const MAX_DLC_BOARDS = 2;
/** A title recorded more recently than this is left alone. */
const MAX_AGE_DAYS = 10;
/** Stop rather than keep pushing once the shops start refusing. */
const RATE_LIMIT_GIVE_UP = 8;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const fresh = flag('--fresh');
const limit = Number(value('--limit') ?? Infinity);
const only = value('--only')
  ?.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

fs.mkdirSync(OUT_DIR, { recursive: true });

/** What we already have; a top-up adds to it rather than replacing it. */
const previous = !fresh && fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;

const snapshot = {
  capturedAt: new Date().toISOString(),
  /**
   * What the demo may advertise: titles actually in the file.
   *
   * This used to be all sixty, which is the WANTED list, not the recorded one —
   * so the demo's banner offered forty-six games it could not answer for, and
   * every one of them was a visitor clicking a button and being told nothing was
   * found. `catalogue` keeps the goal visible without promising it.
   */
  seeds: [],
  catalogue: SEEDS,
  searches: previous?.searches ?? {},
  searchesDlc: previous?.searchesDlc ?? {},
  offers: previous?.offers ?? {},
  meta: previous?.meta ?? {},
  suggest: previous?.suggest ?? {},
  trackStatus: previous?.trackStatus ?? {},
  trackDetail: previous?.trackDetail ?? {},
  /** When each title was last recorded, so a top-up knows what is stale. */
  capturedTitles: previous?.capturedTitles ?? {},
};

// Snapshots taken before this bookkeeping existed still hold real searches;
// treat what they recorded as captured when the file was written, so the first
// top-up does not re-scrape titles it already has.
if (previous && Object.keys(snapshot.capturedTitles).length === 0) {
  for (const key of Object.keys(snapshot.searches)) {
    snapshot.capturedTitles[key] = previous.capturedAt ?? new Date(0).toISOString();
  }
}

let calls = 0;
let rateLimited = 0;

async function get(url, init) {
  calls++;
  const res = await fetch(API + url, { ...init, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
const post = (url, body) =>
  get(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** The exact key DepartureBoard derives from its refs (web/src/DepartureBoard.tsx). */
const refsKey = (refs) => refs.map((r) => `${r.sourceId}:${r.sourceGameId}`).join('|');

/** Rebuild the UI's grouping so we capture the tuples it will actually ask for. */
function groupHits(games) {
  const map = new Map();
  for (const hit of games) {
    const g = map.get(hit.groupKey) ?? { key: hit.groupKey, title: hit.title, byPlatform: new Map() };
    const list = g.byPlatform.get(hit.platform) ?? [];
    list.push({ sourceId: hit.sourceId, sourceGameId: hit.sourceGameId });
    g.byPlatform.set(hit.platform, list);
    map.set(hit.groupKey, g);
  }
  return [...map.values()];
}

/** Count how many sources declined because we rate-limited ourselves. */
function noteRefusals(sources) {
  for (const s of sources ?? []) if (!s.ok && s.reason === 'rate_limited') rateLimited++;
}

async function captureBoards(groups, label) {
  for (const g of groups) {
    for (const [platform, refs] of g.byPlatform) {
      const key = `${platform}|${refsKey(refs)}`;
      if (snapshot.offers[key]) continue;
      try {
        const [o, m] = await Promise.all([post('/api/offers', { refs, platform }), post('/api/meta', { refs })]);
        snapshot.offers[key] = o;
        snapshot.meta[refsKey(refs)] = m.meta ?? null;
        noteRefusals(o.sources);
        console.log(`    ${label} ${g.title} [${platform}] → ${(o.offers ?? []).length} offers`);
      } catch (err) {
        console.log(`    ${label} ${g.title} [${platform}] → FAILED ${err.message}`);
      }
      const status = await get(
        `/api/track/status?title=${encodeURIComponent(g.title)}&platform=${encodeURIComponent(platform)}`
      ).catch(() => ({ tracked: false, history: [] }));
      snapshot.trackStatus[`${g.title.toLowerCase()}|${platform}`] = status;
    }
  }
}

/** How many sources actually answered — the measure of a search's quality. */
const okCount = (r) => (r?.sources ?? []).filter((s) => s.ok && s.count > 0).length;

async function captureTitle(title) {
  const key = title.trim().toLowerCase();
  process.stdout.write(`  "${title}" … `);
  const response = await get(`/api/search?q=${encodeURIComponent(title)}`);
  noteRefusals(response.sources);
  // Never trade a good recording for a worse one. Re-capturing a title while
  // the shops are standing us down would otherwise replace a full result with
  // one missing half its stores — the snapshot would get emptier the more
  // diligently it was refreshed.
  const existing = snapshot.searches[key];
  if (existing && okCount(existing) > okCount(response)) {
    console.log(`kept the earlier recording (${okCount(existing)} sources vs ${okCount(response)} now)`);
  } else {
    snapshot.searches[key] = response;
  }
  const groups = groupHits(response.games);
  // The exactly-matching game first: it is the one the UI auto-opens, so its
  // board must never be the one we ran out of budget for.
  groups.sort((a, b) => (b.key === response.queryKey ? 1 : 0) - (a.key === response.queryKey ? 1 : 0));
  console.log(`${response.games.length} hits, ${groups.length} groups`);
  await captureBoards(groups.slice(0, MAX_GROUPS), '');

  if (DLC_SEEDS.has(title)) {
    const withDlc = await get(`/api/search?q=${encodeURIComponent(title)}&dlc=1`);
    snapshot.searchesDlc[key] = withDlc;
    noteRefusals(withDlc.sources);
    const addons = groupHits(withDlc.games.filter((h) => h.dlc));
    console.log(`    add-ons: ${addons.length} found`);
    await captureBoards(addons.slice(0, MAX_DLC_BOARDS), 'dlc');
  }

  snapshot.capturedTitles[key] = new Date().toISOString();
}

/** Titles that need doing this run: missing first, then the most stale. */
function pending() {
  const now = Date.now();
  const wanted = only ? SEEDS.filter((s) => only.includes(s.toLowerCase())) : SEEDS;
  const scored = wanted
    .map((title) => {
      const at = snapshot.capturedTitles[title.trim().toLowerCase()];
      const ageDays = at ? (now - Date.parse(at)) / 86_400_000 : Infinity;
      return { title, ageDays };
    })
    .filter((s) => only || s.ageDays > MAX_AGE_DAYS)
    .sort((a, b) => b.ageDays - a.ageDays);
  return scored.slice(0, limit).map((s) => s.title);
}

async function main() {
  const todo = pending();
  const done = Object.keys(snapshot.capturedTitles).length;
  console.log(`${done}/${SEEDS.length} titles already recorded; ${todo.length} to do this run\n`);
  if (todo.length === 0) {
    console.log('nothing stale enough to re-capture — snapshot left as it is');
    return;
  }

  for (const title of todo) {
    try {
      await captureTitle(title);
    } catch (err) {
      console.log(`  "${title}" → FAILED ${err.message}`);
    }
    if (rateLimited >= RATE_LIMIT_GIVE_UP) {
      console.log(`\nstopping early: the shops are refusing (${rateLimited} self-limited sources).`);
      console.log('this is the daily budget working. run again tomorrow to continue.');
      break;
    }
  }

  process.stdout.write('\nsuggestions … ');
  const prefixes = new Set();
  for (const s of Object.keys(snapshot.capturedTitles)) for (const p of prefixesOf(s)) prefixes.add(p);
  for (const p of prefixes) {
    if (snapshot.suggest[p]) continue;
    const r = await get(`/api/suggest?q=${encodeURIComponent(p)}`).catch(() => ({ suggestions: [] }));
    if (r.suggestions?.length) snapshot.suggest[p] = r.suggestions;
  }
  console.log(`${Object.keys(snapshot.suggest).length} prefixes`);

  process.stdout.write('wishlist … ');
  const wl = await get('/api/wishlist');
  snapshot.wishlist = wl.items ?? [];
  for (const item of snapshot.wishlist) {
    snapshot.trackDetail[item.id] = await get(`/api/track/${item.id}/detail`);
  }
  console.log(`${snapshot.wishlist.length} tracked games`);

  // A machine with no tracking database of its own — a fresh CI checkout, say —
  // would otherwise replace a month of real price history with nothing, turning
  // the demo's graphs and verdicts back into a search box.
  if (snapshot.wishlist.length === 0 && previous?.wishlist?.length) {
    snapshot.wishlist = previous.wishlist;
    snapshot.trackDetail = previous.trackDetail ?? {};
    snapshot.carriedTracking = true;
    console.log(`  (no local tracking data — kept ${snapshot.wishlist.length} games from the previous snapshot)`);
  }

  snapshot.settings = await get('/api/settings');

  // Deliberately NOT captured: sale alerts are the operator's own inbox, and a
  // public demo is the wrong place for someone's notifications.
  snapshot.notifications = [];
  // Reported unconfigured because in the demo it is true: there is no server to
  // hold a key and none ships.
  snapshot.keys = { ggdeals: { configured: false, source: 'none' }, itad: { configured: false, source: 'none' } };

  snapshot.health = await get('/api/health').catch(() => ({ report: null, due: false }));
  snapshot.psnHash = await get('/api/psn-hash').catch(() => null);
  snapshot.ticker = (await get('/api/ticker').catch(() => ({ deals: [] }))).deals ?? [];

  if (!snapshot.carriedTracking) {
    for (const [route, file] of [
      ['/api/export', 'demo-export.json'],
      ['/api/export.csv', 'demo-export.csv'],
    ]) {
      const res = await fetch(API + route, { signal: AbortSignal.timeout(60_000) });
      fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(await res.arrayBuffer()));
    }
  }

  // Written last, from what actually landed in the file — never from the wanted
  // list. A title whose capture failed halfway is not something to advertise.
  snapshot.seeds = SEEDS.filter((title) => snapshot.searches[title.trim().toLowerCase()]);

  fs.writeFileSync(OUT, JSON.stringify(snapshot));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  const recorded = Object.keys(snapshot.capturedTitles).length;
  console.log(`\nwrote ${OUT} — ${kb} KB, ${recorded}/${SEEDS.length} titles, ${calls} live calls this run`);
  if (recorded < SEEDS.length) console.log(`run again to add the remaining ${SEEDS.length - recorded}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
