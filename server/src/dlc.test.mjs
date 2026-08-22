import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeDlc, describeProduct } from './normalize.ts';

/**
 * Add-on filtering, and above all what it must NOT eat.
 *
 * Every entry in the "still a game" list is a real title that a careless pattern
 * swallows: "Ghost of Tsushima" contains "ost", "Demon's Souls" starts with
 * "demo", "Coin" hides inside other words. Hiding a game the user searched for
 * is far worse than leaving one season pass on screen, so these are the tests
 * that matter most here.
 */

test('recognises add-on content', () => {
  for (const title of [
    'Far Cry 6 - Season Pass',
    'Far Cry 6 Starter Pack',
    'Far Cry 6 Base Pack 500',
    'Cyberpunk 2077 Soundtrack',
    'FIFA 23 - 2200 FUT Points Pack',
    'Assassin’s Creed Valhalla - Expansion Pass',
    'Call of Duty Battle Pass',
    'Some Game Free Trial',
    'Mass Effect Demo',
    'Elden Ring Upgrade Edition',
    'GTA V 1,000,000 Coins',
    'Far Cry 6 X-Large Pack',
    'Far Cry 6 Medium Pack',
    'Far Cry 6 Episode 2 Pagan: Control',
    'EA SPORTS FC 25 Spanish - In-Game Commentary',
    'Forza Motorsport Premium Add-Ons',
    'Forza Horizon 5: Car Pass',
    'Mario Kart 8 Deluxe - Booster Course Pass',
    'Additional mini-game "Halo Jump!"',
  ]) {
    assert.equal(looksLikeDlc(title), true, `should be add-on: ${title}`);
  }
});

test('does NOT eat games whose names merely contain those letters', () => {
  for (const title of [
    'Ghost of Tsushima', // contains "ost"
    'Ghostrunner',
    'Frostpunk',
    'Lost Judgment',
    "Demon's Souls", // starts with "demo"
    'Democracy 4',
    'Outer Wilds',
    'Expeditions: Rome', // starts with "exp"
    'Coin Crypt', // hmm: a real game with Coin in the name
    'Battlefield 2042',
    'Battletoads',
    'Passpartout',
    'Mountain Rescue',
    'Additive',
    'Packing Simulator',
    'Episode Prompto',
    'Far Cry 6',
    'Grand Theft Auto V',
  ]) {
    assert.equal(looksLikeDlc(title), false, `should stay a game: ${title}`);
  }
});

test('describeProduct exposes the flag', () => {
  assert.equal(describeProduct('Far Cry 6 Season Pass').dlc, true);
  assert.equal(describeProduct('Far Cry 6').dlc, false);
  // An edition is a game, not an add-on.
  assert.equal(describeProduct('Far Cry 6 Gold Edition').dlc, false);
});
