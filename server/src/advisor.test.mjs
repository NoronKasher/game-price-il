import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genreAffinity, scoreCandidate, mostPlayed } from './advisor.ts';

/**
 * The recommender's arithmetic.
 *
 * It is an alpha feature and says so, but "alpha" is not a licence for it to
 * be obviously wrong. The cases below are the ways a recommender embarrasses
 * itself: suggesting something the person already owns, letting a bundle of
 * unplayed games define their taste, and letting one obsession drown out
 * everything else.
 */

const owned = [
  { appId: '1', title: 'Big RPG', minutes: 6000, recentMinutes: 0 }, // 100h
  { appId: '2', title: 'Small RPG', minutes: 600, recentMinutes: 0 }, // 10h
  { appId: '3', title: 'A Shooter', minutes: 300, recentMinutes: 0 }, // 5h
  { appId: '4', title: 'Never Started', minutes: 0, recentMinutes: 0 },
  { appId: '5', title: 'Barely Touched', minutes: 30, recentMinutes: 0 },
];

const GENRES = {
  '1': ['RPG', 'Open World'],
  '2': ['RPG'],
  '3': ['Shooter'],
  '4': ['Puzzle'],
  '5': ['Puzzle'],
};
const genresOf = (id) => GENRES[id];

test('a game you never started says nothing about your taste', () => {
  // Bundles and giveaways fill a library with games nobody opened. Counting
  // them would make "Puzzle" a top genre for somebody who has never played one.
  const affinity = genreAffinity(owned, genresOf);
  assert.ok(!affinity.some((a) => a.genre === 'Puzzle'), JSON.stringify(affinity));
});

test('hours decide, not how many games you own', () => {
  const affinity = genreAffinity(owned, genresOf);
  assert.equal(affinity[0].genre, 'RPG');
  assert.ok(affinity[0].hours > affinity.find((a) => a.genre === 'Shooter').hours);
});

test('one obsession cannot become the whole profile', () => {
  // A 3,000-hour game would otherwise swamp everything. Capped per game, so a
  // library still has more than one opinion in it.
  const obsessed = [
    { appId: '1', title: 'Forever Game', minutes: 180000, recentMinutes: 0 }, // 3000h
    { appId: '3', title: 'A Shooter', minutes: 3000, recentMinutes: 0 }, // 50h
  ];
  const affinity = genreAffinity(obsessed, genresOf);
  const rpg = affinity.find((a) => a.genre === 'RPG').hours;
  const shooter = affinity.find((a) => a.genre === 'Shooter').hours;
  assert.ok(rpg / shooter < 4, `one game must not be 60x the rest (was ${rpg}/${shooter})`);
});

/* ── Scoring ─────────────────────────────────────────────────────────────── */

const affinity = genreAffinity(owned, genresOf);
const ownedIds = new Set(owned.map((g) => g.appId));

test('a game you already own is never suggested', () => {
  // The single most obvious way for this to look stupid, and the library is
  // right there in memory.
  const already = scoreCandidate({ appId: '1', title: 'Big RPG', genres: ['RPG'] }, affinity, ownedIds);
  assert.equal(already, null);
});

test('a match on your strongest genre scores above a weak one', () => {
  const strong = scoreCandidate({ appId: '9', title: 'New RPG', genres: ['RPG'] }, affinity, ownedIds);
  const weak = scoreCandidate({ appId: '10', title: 'New Shooter', genres: ['Shooter'] }, affinity, ownedIds);
  assert.ok(strong.score > weak.score, `${strong.score} vs ${weak.score}`);
});

test('every suggestion explains itself', () => {
  // A score with no reason is something people either believe blindly or
  // dismiss entirely, and both are worse than an argument they can check.
  const s = scoreCandidate({ appId: '9', title: 'New RPG', genres: ['RPG'] }, affinity, ownedIds);
  assert.ok(s.because.length > 0);
  assert.match(s.because[0], /RPG/);
  assert.match(s.because[0], /שעות/);
});

test('a game sharing nothing with your library is not suggested at all', () => {
  // Better to say nothing than to pad the list with a score of 3.
  assert.equal(
    scoreCandidate({ appId: '11', title: 'Farming Sim', genres: ['Farming'] }, affinity, ownedIds),
    null
  );
});

test('a game with no genre information is skipped, not scored as zero', () => {
  assert.equal(scoreCandidate({ appId: '12', title: 'Unknown', genres: [] }, affinity, ownedIds), null);
});

test('breadth alone does not beat fit', () => {
  // Something tagged with every genre under the sun must not win by covering
  // one of yours plus nine you have never touched.
  const focused = scoreCandidate({ appId: '13', title: 'Pure RPG', genres: ['RPG'] }, affinity, ownedIds);
  const scattergun = scoreCandidate(
    { appId: '14', title: 'Everything', genres: ['Shooter', 'Farming', 'Sports', 'Racing', 'Puzzle'] },
    affinity,
    ownedIds
  );
  assert.ok(focused.score > (scattergun?.score ?? 0), `${focused.score} vs ${scattergun?.score}`);
});

test('an empty library produces no suggestions rather than nonsense', () => {
  assert.deepEqual(genreAffinity([], genresOf), []);
  assert.equal(scoreCandidate({ appId: '9', title: 'x', genres: ['RPG'] }, [], new Set()), null);
});

/* ── Which games to look up ──────────────────────────────────────────────── */

test('the profile is built from the most-played games', () => {
  // Each lookup is a request to Steam, so a 2,000-game library must cost the
  // same as a 40-game one — and the most-played are the ones that say anything.
  const top = mostPlayed(owned, 2);
  assert.deepEqual(top.map((g) => g.appId), ['1', '2']);
});

test('unplayed games are not sampled even when the library is small', () => {
  const top = mostPlayed(owned, 99);
  assert.ok(!top.some((g) => g.appId === '4'), 'never started');
  assert.ok(!top.some((g) => g.appId === '5'), 'barely touched');
});
