/**
 * Freeze a real run of the tool into a snapshot the static demo can serve.
 *
 * The public demo lives on GitHub Pages, which serves files and nothing else —
 * no Node process, so no SQLite, no scraping, no fifteen-source fan-out. Rather
 * than fake the data (a demo that invents prices is a lie about what the tool
 * found), this drives the REAL server exactly the way the browser does and
 * records every answer.
 *
 * The keys below mirror the shapes the UI actually asks for, so a lookup in the
 * demo always hits: searches by trimmed query, offers/meta by the same
 * `sourceId:sourceGameId|...` refs key DepartureBoard builds, plus platform.
 *
 *   node web/demo/capture.mjs            # needs the server on :5174
 */
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.VGPT_API ?? 'http://localhost:5174';
const OUT_DIR = path.join(import.meta.dirname, 'public');
const OUT = path.join(OUT_DIR, 'snapshot.json');

/**
 * Games worth putting in a shop window: each one exercises a different corner
 * of the tool — Israeli discs, key shops, regional console stores, a game with
 * several editions, and one tracked long enough to have a real price graph.
 */
const SEEDS = [
  'Elden Ring',
  'God of War Ragnarok',
  'Borderlands 4',
  'Hogwarts Legacy',
  'Cyberpunk 2077',
  'Far Cry 6',
];

/** Prefixes of the seeds, so the autocomplete has something to answer with. */
function prefixesOf(title) {
  const out = new Set();
  const clean = title.toLowerCase();
  for (let n = 3; n <= Math.min(clean.length, 12); n++) out.add(clean.slice(0, n).trim());
  return [...out].filter((p) => p.length >= 3);
}

/** Cap the work: a search fans out to fifteen stores, and so does every board. */
const MAX_GROUPS = 4;

const snapshot = {
  capturedAt: new Date().toISOString(),
  // Recorded so the demo can NAME what it covers. Searches are keyed by
  // lowercased query; these keep the titles as a person would write them.
  seeds: SEEDS,
  searches: {},
  offers: {},
  meta: {},
  suggest: {},
  trackStatus: {},
  trackDetail: {},
};

let calls = 0;
async function get(url, init) {
  calls++;
  const res = await fetch(API + url, { ...init, signal: AbortSignal.timeout(120_000) });
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

async function captureSearch(q) {
  process.stdout.write(`search "${q}" ... `);
  const response = await get(`/api/search?q=${encodeURIComponent(q)}`);
  snapshot.searches[q.trim().toLowerCase()] = response;
  const groups = groupHits(response.games);
  // The exactly-matching game first: it is the one the UI auto-opens, so its
  // board must never be the one we ran out of budget for.
  groups.sort((a, b) => (b.key === response.queryKey ? 1 : 0) - (a.key === response.queryKey ? 1 : 0));
  console.log(`${response.games.length} hits, ${groups.length} groups`);

  for (const g of groups.slice(0, MAX_GROUPS)) {
    for (const [platform, refs] of g.byPlatform) {
      const key = `${platform}|${refsKey(refs)}`;
      if (snapshot.offers[key]) continue;
      try {
        const [o, m] = await Promise.all([post('/api/offers', { refs, platform }), post('/api/meta', { refs })]);
        // Stored whole — `sources` carries the honest "this store didn't
        // answer" notice, which the demo should show exactly as it happened.
        snapshot.offers[key] = o;
        snapshot.meta[refsKey(refs)] = m.meta ?? null;
        console.log(`  ${g.title} [${platform}] -> ${(o.offers ?? []).length} offers`);
      } catch (err) {
        console.log(`  ${g.title} [${platform}] -> FAILED ${err.message}`);
      }
      const status = await get(
        `/api/track/status?title=${encodeURIComponent(g.title)}&platform=${encodeURIComponent(platform)}`
      ).catch(() => ({ tracked: false, history: [] }));
      snapshot.trackStatus[`${g.title.toLowerCase()}|${platform}`] = status;
    }
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const q of SEEDS) await captureSearch(q);

  process.stdout.write('suggestions ... ');
  const prefixes = new Set();
  for (const s of SEEDS) for (const p of prefixesOf(s)) prefixes.add(p);
  for (const p of prefixes) {
    const r = await get(`/api/suggest?q=${encodeURIComponent(p)}`).catch(() => ({ suggestions: [] }));
    if (r.suggestions?.length) snapshot.suggest[p] = r.suggestions;
  }
  console.log(`${Object.keys(snapshot.suggest).length} prefixes`);

  process.stdout.write('wishlist ... ');
  const wl = await get('/api/wishlist');
  snapshot.wishlist = wl.items ?? [];
  for (const item of snapshot.wishlist) {
    snapshot.trackDetail[item.id] = await get(`/api/track/${item.id}/detail`);
  }
  console.log(`${snapshot.wishlist.length} tracked games`);

  snapshot.settings = await get('/api/settings');

  // Deliberately NOT captured.
  //
  // Sale alerts are the operator's own inbox — "God of War Ragnarok dropped to
  // ₪124.76" is a message written to one person about one person's tracking
  // list, and publishing it puts someone's notifications on a shop window. The
  // bell and the alert settings still demonstrate the feature; the personal
  // items do not travel.
  snapshot.notifications = [];

  // Key status is reported as unconfigured because in the demo it IS: there is
  // no server to hold a key and none is shipped. Echoing the capturing
  // machine's "configured" state would claim otherwise.
  snapshot.keys = { ggdeals: { configured: false, source: 'none' }, itad: { configured: false, source: 'none' } };
  snapshot.health = await get('/api/health').catch(() => ({ report: null, due: false }));
  snapshot.psnHash = await get('/api/psn-hash').catch(() => null);
  snapshot.ticker = (await get('/api/ticker').catch(() => ({ deals: [] }))).deals ?? [];

  // The two export buttons are plain links to server routes, which do not
  // exist on a static host — so the real files are captured and shipped
  // alongside, and the demo page points the buttons at them.
  for (const [route, file] of [
    ['/api/export', 'demo-export.json'],
    ['/api/export.csv', 'demo-export.csv'],
  ]) {
    const res = await fetch(API + route, { signal: AbortSignal.timeout(60_000) });
    fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(await res.arrayBuffer()));
  }

  fs.writeFileSync(OUT, JSON.stringify(snapshot));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`\nwrote ${OUT} — ${kb} KB from ${calls} live calls`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
