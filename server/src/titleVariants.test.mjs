import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupKey, describeProduct } from './normalize.ts';

/**
 * The same game, written the way different stores write it.
 *
 * Reported as "Diablo 4 and Diablo IV show up twice", but the class is much
 * wider than one game: every store has a house style, and any difference in it
 * splits one game into two cards. These are the differences that actually occur
 * in this tool's sources — checked against live results, not imagined.
 *
 * The second block matters as much as the first. Grouping too eagerly is worse
 * than grouping too little: a missed merge shows a game twice, while a wrong one
 * merges two different games and hides one of them behind the other's prices.
 */

const merges = (a, b) => assert.equal(groupKey(a), groupKey(b), `${a} ≠ ${b}`);
const stayApart = (a, b) =>
  assert.notEqual(groupKey(a), groupKey(b), `${a} was wrongly merged with ${b}`);

test('roman and arabic numerals name the same sequel', () => {
  merges('Diablo IV', 'Diablo 4');
  merges('Final Fantasy VII Rebirth', 'Final Fantasy 7 Rebirth');
  merges('Sid Meier’s Civilization VI', 'Sid Meiers Civilization 6');
  merges('Diablo III: Eternal Collection', 'Diablo 3 Eternal Collection');
});

test('a trailing single-letter numeral counts, a leading one does not', () => {
  // Where a sequel number lives, "V" is five.
  merges('Grand Theft Auto V', 'Grand Theft Auto 5');
  merges('The Last of Us Part I', 'The Last of Us Part 1');
  // Anywhere else it is a letter: these must not become "10 men" and "1 am…".
  stayApart('X-Men', '10 Men');
  stayApart('I Am Setsuna', '1 Am Setsuna');
});

test('possessive apostrophes do not split a franchise', () => {
  // The apostrophe is deleted rather than split on, or "assassin s creed" and
  // "assassins creed" are two games.
  merges("Assassin's Creed Mirage", 'Assassins Creed Mirage');
  merges("Marvel's Spider-Man 2", 'Marvels Spider Man 2');
  merges("Tom Clancy's The Division 2", 'Tom Clancys The Division 2');
  merges("Baldur's Gate 3", 'Baldurs Gate 3');
  merges("Assassin's Creed® Valhalla", 'Assassins Creed Valhalla');
});

test('case, accents, punctuation and trademark marks are all noise', () => {
  merges('ELDEN RING', 'Elden Ring');
  merges('Pokémon Scarlet', 'Pokemon Scarlet');
  merges('F1® 24', 'F1 24');
  merges('The Witcher 3: Wild Hunt', 'The Witcher 3 Wild Hunt');
  merges('Star Wars Jedi: Survivor', 'STAR WARS Jedi Survivor');
});

test('a sequel is never merged into the game before it', () => {
  stayApart('Hades', 'Hades II');
  stayApart('Far Cry', 'Far Cry 2');
  stayApart('Portal', 'Portal 2');
  stayApart('Diablo II Resurrected', 'Diablo IV');
  stayApart('Diablo III', 'Diablo IV');
});

test('an upgrade bought on top of a game is an add-on', () => {
  // Named with no edition word at all, which the earlier rule required.
  assert.equal(describeProduct('Diablo IV Prime Evil Upgrade').dlc, true);
  assert.equal(describeProduct('Diablo IV: Prime Evil Upgrade').dlc, true);
  assert.equal(describeProduct('Cyberpunk 2077 Phantom Liberty Upgrade').dlc, true);
  assert.equal(describeProduct('STAR WARS Jedi: Fallen Order™ Deluxe Upgrade').dlc, true);
});

test('…but a game whose name contains "upgrade" is still a game', () => {
  // Positional, not another keyword: hiding a real game is the worse error.
  assert.equal(describeProduct('Upgrade Simulator').dlc, false);
  assert.equal(describeProduct('The Upgrade').dlc, false);
  assert.equal(describeProduct('Diablo IV').dlc, false);
  assert.equal(describeProduct('Diablo IV Standard Edition').dlc, false);
});
