import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProduct, groupKey } from './normalize.ts';
import { searchGames } from './fanout.ts';

/**
 * Two ways the same game showed up three times.
 *
 * Reported from a real search for "jedi fallen order": a card for "Jedi Fallen
 * Order" (EA's shorter name), another for "Star Wars Jedi Fallen Order", and a
 * third for the Deluxe Upgrade — which is an add-on, with the add-on filter off.
 */

/** A source that answers any search with a fixed list of titles. */
function fakeSource(id, titles) {
  return {
    id,
    name: id,
    nameHe: id,
    platforms: ['pc'],
    enabled: true,
    async search() {
      return titles.map((title, i) => ({
        sourceId: id,
        sourceGameId: `${id}-${i}`,
        title,
        groupKey: groupKey(title),
        edition: null,
        platform: 'pc',
      }));
    },
    async getOffers() {
      return [];
    },
  };
}

test('an upgrade sold on top of a game is an add-on, not a game', () => {
  assert.equal(describeProduct('STAR WARS Jedi: Fallen Order™ Deluxe Upgrade').dlc, true);
  assert.equal(describeProduct('God of War Ragnarok - Digital Deluxe Edition Upgrade').dlc, true);
  assert.equal(describeProduct('Cyberpunk 2077: Ultimate Upgrade').dlc, true);
});

test('an edition is still a game, and so is a game called Upgrade', () => {
  // The rule is anchored to the edition words for exactly this reason: matching
  // "upgrade" alone would hide real games.
  assert.equal(describeProduct('STAR WARS Jedi: Fallen Order Deluxe Edition').dlc, false);
  assert.equal(describeProduct('Upgrade Simulator').dlc, false);
  assert.equal(describeProduct('The Upgrade').dlc, false);
});

test("one store's shorter title groups with everyone else's full one", async () => {
  const result = await searchGames(
    [
      fakeSource('ea', ['Jedi Fallen Order']),
      fakeSource('steam', ['Star Wars Jedi Fallen Order']),
    ],
    'jedi fallen order'
  );
  const keys = new Set(result.games.map((g) => g.groupKey));
  assert.equal(keys.size, 1, `expected one group, got ${[...keys].join(' | ')}`);
  assert.equal([...keys][0], 'star wars jedi fallen order', 'the fullest title should win');
});

test('a sequel is NOT merged into the game it follows', async () => {
  // Franchise names are prepended, sequels appended — which is why the rule is
  // "suffix", not "contains". "hades ii" does not END with "hades".
  const result = await searchGames(
    [fakeSource('a', ['Hades']), fakeSource('b', ['Hades II'])],
    'hades'
  );
  const keys = new Set(result.games.map((g) => g.groupKey));
  assert.equal(keys.size, 2, 'Hades and Hades II are different games');
});

test('a one-word title is never absorbed by a longer one', async () => {
  const result = await searchGames(
    [fakeSource('a', ['Rally']), fakeSource('b', ['Dirt Rally'])],
    'rally'
  );
  const keys = new Set(result.games.map((g) => g.groupKey));
  assert.equal(keys.size, 2, 'a game called "Rally" is not part of "Dirt Rally"');
});

test('the merge lands on a word boundary, not mid-word', async () => {
  const result = await searchGames(
    [fakeSource('a', ['ands of Time']), fakeSource('b', ['Sands of Time'])],
    'sands of time'
  );
  const keys = new Set(result.games.map((g) => g.groupKey));
  assert.equal(keys.size, 2, '"…ands of time" must not swallow "sands of time"');
});

test('the add-on filter keeps upgrades out unless asked for', async () => {
  const titles = ['Star Wars Jedi Fallen Order', 'STAR WARS Jedi: Fallen Order Deluxe Upgrade'];
  const without = await searchGames([fakeSource('ea', titles)], 'jedi fallen order');
  assert.equal(without.games.length, 1, 'the upgrade should be filtered out');

  const withDlc = await searchGames([fakeSource('ea', titles)], 'jedi fallen order', true);
  assert.equal(withDlc.games.length, 2, 'and shown when the user opts in');
  assert.ok(withDlc.games.some((g) => g.dlc), '…labelled as an add-on');
});

test('the exact-match key follows the merge, so the game still auto-opens', async () => {
  // Typing the short name has to keep opening the game, even though its group is
  // now filed under the fuller title.
  const result = await searchGames(
    [
      fakeSource('ea', ['Jedi Fallen Order']),
      fakeSource('steam', ['Star Wars Jedi Fallen Order']),
    ],
    'jedi fallen order'
  );
  assert.equal(result.queryKey, 'star wars jedi fallen order');
  assert.ok(
    result.games.some((g) => g.groupKey === result.queryKey),
    'the exact-match key must name a group that exists'
  );
});
