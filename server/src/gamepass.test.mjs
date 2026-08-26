import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inclusionsFor, __resetGamePassCache, TIERS } from './adapters/gamepass.ts';

/**
 * Which subscriptions already carry a game.
 *
 * The failure that matters here is not a missing badge — it is a WRONG one.
 * Telling an Israeli buyer a game is covered when it is only in the American
 * catalogue, or when it left Game Pass last month, talks them out of a purchase
 * they actually needed to make. So these cases pin the market, what happens when
 * a list cannot be read, and that a stale answer is never preferred to none.
 */

const real = globalThis.fetch;

/** `bySigl` maps a list id to the product ids that list should return. */
function withCatalog(bySigl, fn, spy) {
  __resetGamePassCache();
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    const sigl = u.searchParams.get('id') ?? '';
    spy?.push({ sigl, market: u.searchParams.get('market') });
    const entry = bySigl[sigl];
    if (entry === 'fail') return new Response('nope', { status: 503 });
    // The real shape: element zero is the list's own metadata, then { id } rows.
    const body = [{ siglId: sigl, title: 'A list' }, ...(entry ?? []).map((id) => ({ id }))];
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return fn().finally(() => {
    globalThis.fetch = real;
    __resetGamePassCache();
  });
}

const CONSOLE_SIGL = TIERS[0].sigl;
const PC_SIGL = TIERS[1].sigl;
const EA_SIGL = TIERS[2].sigl;

test('a product in the console list comes back named', async () => {
  const found = await withCatalog({ [CONSOLE_SIGL]: ['9ND0JVB184XL'] }, () =>
    inclusionsFor('9ND0JVB184XL')
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'gamepass-console');
  assert.equal(found[0].market, 'IL', 'the market is the whole caveat and must always ride along');
});

test('a product in nothing comes back empty', async () => {
  const found = await withCatalog({ [CONSOLE_SIGL]: ['SOMETHINGELSE'] }, () =>
    inclusionsFor('9ND0JVB184XL')
  );
  assert.deepEqual(found, []);
});

test('every list is asked for the Israeli market, never a default one', async () => {
  // Answering from the US catalogue would tell an Israeli buyer not to buy
  // something they cannot actually play — worse than saying nothing at all.
  const spy = [];
  await withCatalog({}, () => inclusionsFor('9ND0JVB184XL'), spy);
  assert.equal(spy.length, TIERS.length, 'all tiers consulted');
  assert.ok(spy.every((s) => s.market === 'IL'));
});

test('membership in several tiers reports all of them, in a stable order', async () => {
  const found = await withCatalog(
    { [CONSOLE_SIGL]: ['ABC1234567'], [PC_SIGL]: ['ABC1234567'], [EA_SIGL]: ['ABC1234567'] },
    () => inclusionsFor('ABC1234567')
  );
  assert.deepEqual(
    found.map((f) => f.id),
    ['gamepass-console', 'gamepass-pc', 'eaplay'],
    'order must not depend on which list answered first'
  );
});

test('a list that cannot be read yields no badge, and never breaks the board', async () => {
  // A subscription lookup must not be able to take the prices down with it.
  const found = await withCatalog(
    { [CONSOLE_SIGL]: 'fail', [PC_SIGL]: ['ABC1234567'] },
    () => inclusionsFor('ABC1234567')
  );
  assert.deepEqual(found.map((f) => f.id), ['gamepass-pc'], 'the tier that answered still counts');
});

test('product ids match regardless of the case they arrive in', async () => {
  const found = await withCatalog({ [CONSOLE_SIGL]: ['abc1234567'] }, () => inclusionsFor('ABC1234567'));
  assert.equal(found.length, 1);
});

test('ten games opened at once cost one request per list, not ten', async () => {
  // Otherwise browsing a search page would hammer Microsoft for an answer we
  // already had in memory.
  const spy = [];
  await withCatalog(
    { [CONSOLE_SIGL]: ['ABC1234567'] },
    async () => {
      await Promise.all(Array.from({ length: 10 }, () => inclusionsFor('ABC1234567')));
    },
    spy
  );
  assert.equal(spy.length, TIERS.length, 'one fetch per list for the whole burst');
});
