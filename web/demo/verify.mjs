/**
 * Is this snapshot fit to publish?
 *
 * A capture can "succeed" while quietly losing half the tool: a store redesigns,
 * or the machine doing the capture is refused where a normal visitor would not
 * be. The result is a demo that looks fine and silently misrepresents what
 * VGPT.IL finds — the same failure the health canary exists to catch, one layer
 * up. Publishing a degraded snapshot is worse than publishing a stale one, so
 * this refuses rather than warns.
 *
 *   node web/demo/verify.mjs [path]
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2] ?? path.join(import.meta.dirname, 'public', 'snapshot.json');

/** The Israeli retailers are the reason this tool exists; a snapshot without them is not it. */
const ISRAELI = ['vgs', 'player1', 'arcadia', 'gamestorm', 'ivory', 'bug'];
const MIN_ISRAELI = 3;
/**
 * Titles the demo needs to be worth showing.
 *
 * NOT "all of them": the capture is incremental on purpose — sixty titles would
 * spend a shop's entire daily allowance in one sitting — so the library fills up
 * over several days and a partial snapshot is the normal, healthy state. What
 * must never ship is one so thin that a visitor's first guess finds nothing.
 */
const MIN_TITLES = 10;
const MIN_OFFER_SETS = 30;
const MIN_TOTAL_OFFERS = 200;

const problems = [];
const note = (ok, message) => {
  console.log(`${ok ? '  ok ' : '  NO '} ${message}`);
  if (!ok) problems.push(message);
};

let snapshot;
try {
  snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`cannot read ${file}: ${err.message}`);
  process.exit(1);
}

console.log(`checking ${path.basename(file)} (captured ${snapshot.capturedAt ?? '?'})`);

const seeds = snapshot.seeds ?? [];
note(seeds.length >= 4, `${seeds.length} seed games recorded`);

const recorded = seeds.filter((g) => (snapshot.searches ?? {})[g.trim().toLowerCase()]);
note(
  recorded.length >= MIN_TITLES,
  `${recorded.length}/${seeds.length} titles recorded (need ${MIN_TITLES})`
);
if (recorded.length < seeds.length) {
  console.log(`       ${seeds.length - recorded.length} still to capture — run "npm run demo:capture" again`);
}

const withDlc = Object.keys(snapshot.searchesDlc ?? {}).length;
console.log(`       ${withDlc} title(s) have a recorded add-on search`);

const offerSets = Object.keys(snapshot.offers ?? {}).length;
note(offerSets >= MIN_OFFER_SETS, `${offerSets} offer sets (need ${MIN_OFFER_SETS})`);

let totalOffers = 0;
for (const payload of Object.values(snapshot.offers ?? {})) totalOffers += (payload.offers ?? []).length;
note(totalOffers >= MIN_TOTAL_OFFERS, `${totalOffers} priced offers (need ${MIN_TOTAL_OFFERS})`);

/** Which sources actually contributed something, across searches and offers. */
const contributing = new Set();
for (const response of Object.values(snapshot.searches ?? {})) {
  for (const s of response.sources ?? []) if (s.ok && s.count > 0) contributing.add(s.id);
}
for (const payload of Object.values(snapshot.offers ?? {})) {
  for (const s of payload.sources ?? []) if (s.ok && s.count > 0) contributing.add(s.id);
}

const israeliPresent = ISRAELI.filter((id) => contributing.has(id));
note(
  israeliPresent.length >= MIN_ISRAELI,
  `${israeliPresent.length} Israeli retailers answered [${israeliPresent.join(', ') || 'none'}] (need ${MIN_ISRAELI})`
);
console.log(`       all contributing sources: ${[...contributing].sort().join(', ') || 'none'}`);

// Tracking data is what makes the graphs and verdicts real; an empty list turns
// the demo back into a search box.
const tracked = (snapshot.wishlist ?? []).length;
const points = Object.values(snapshot.trackDetail ?? {}).reduce((n, d) => n + (d.history?.length ?? 0), 0);
note(tracked > 0 && points > 0, `${tracked} tracked games with ${points} price points`);

// Personal data that must never ship — see the capture script.
note((snapshot.notifications ?? []).length === 0, 'no personal sale alerts included');
const keysClaimed = Object.values(snapshot.keys ?? {}).some((k) => k?.configured);
note(!keysClaimed, 'API keys reported as unconfigured');

if (problems.length) {
  console.error(`\nsnapshot NOT fit to publish — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('\nsnapshot is fit to publish');
