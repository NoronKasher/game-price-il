import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProfileInput,
  resolveProfile,
  fetchWishlist,
  importWishlist,
} from './steamWishlist.ts';

/**
 * Importing a Steam wishlist.
 *
 * Two things here are worth pinning down. The first is that people paste
 * whatever they have — a URL, a vanity name, the raw id — and being told "not a
 * valid profile" for a perfectly good profile link is where an import gets
 * abandoned. The second is politeness: the import walks the wishlist one title
 * at a time on purpose, and a refactor that quietly fires eighty parallel
 * requests at Valve would still pass every functional assertion.
 */

const real = globalThis.fetch;

function withFetch(handler, fn) {
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = real;
    });
}

/* ── What people actually paste ──────────────────────────────────────────── */

test('a raw SteamID64 is taken as-is', () => {
  assert.deepEqual(parseProfileInput('76561197960287930'), { kind: 'id', value: '76561197960287930' });
});

test('both profile URL shapes are understood', () => {
  assert.deepEqual(parseProfileInput('https://steamcommunity.com/profiles/76561197960287930'), {
    kind: 'id',
    value: '76561197960287930',
  });
  assert.deepEqual(parseProfileInput('https://steamcommunity.com/id/gabelogannewell/'), {
    kind: 'vanity',
    value: 'gabelogannewell',
  });
});

test('a trailing path or query does not break a vanity URL', () => {
  // People copy the URL from wherever they happen to be standing on the profile.
  assert.deepEqual(parseProfileInput('https://steamcommunity.com/id/someone/games/?tab=all'), {
    kind: 'vanity',
    value: 'someone',
  });
});

test('a bare username is treated as a vanity name', () => {
  assert.deepEqual(parseProfileInput('someone'), { kind: 'vanity', value: 'someone' });
});

test('nonsense is rejected rather than guessed at', () => {
  assert.equal(parseProfileInput(''), null);
  assert.equal(parseProfileInput('   '), null);
  assert.equal(parseProfileInput('two words'), null);
  assert.equal(parseProfileInput('https://example.com/not-steam'), null);
});

test('a vanity name is resolved through the public profile view', async () => {
  const seen = [];
  const id = await withFetch(
    async (url) => {
      seen.push(String(url));
      return new Response(
        '<?xml version="1.0"?><profile><steamID64>76561197960287930</steamID64></profile>',
        { status: 200 }
      );
    },
    () => resolveProfile('https://steamcommunity.com/id/gabelogannewell')
  );
  assert.equal(id, '76561197960287930');
  assert.ok(seen[0].includes('xml=1'), 'the keyless profile view, not an API needing a registered key');
});

test('an id needs no lookup at all', async () => {
  let called = false;
  const id = await withFetch(
    async () => {
      called = true;
      return new Response('', { status: 200 });
    },
    () => resolveProfile('76561197960287930')
  );
  assert.equal(id, '76561197960287930');
  assert.equal(called, false, 'resolving an id we already have would be a wasted request');
});

/* ── The wishlist itself ─────────────────────────────────────────────────── */

test('the wishlist comes back newest-wanted first', async () => {
  const entries = await withFetch(
    async () =>
      new Response(
        JSON.stringify({
          response: {
            items: [
              { appid: 111, date_added: 100 },
              { appid: 222, date_added: 900 },
              { appid: 333, date_added: 500 },
            ],
          },
        }),
        { status: 200 }
      ),
    () => fetchWishlist('76561197960287930')
  );
  assert.deepEqual(
    entries.map((e) => e.appId),
    ['222', '333', '111']
  );
});

test('a private or empty wishlist is an empty list, not an error', async () => {
  // Valve answers 200 with nothing for both. The caller says so in those words
  // rather than picking one and being wrong half the time.
  const entries = await withFetch(
    async () => new Response(JSON.stringify({ response: {} }), { status: 200 }),
    () => fetchWishlist('76561197960287930')
  );
  assert.deepEqual(entries, []);
});

/* ── The import ──────────────────────────────────────────────────────────── */

/** A sink that records what would have been tracked. */
function fakeSink(alreadyTracked = []) {
  const have = new Set(alreadyTracked);
  const added = [];
  return {
    added,
    has: (appId) => have.has(appId),
    add: (row) => {
      have.add(row.refs[0].sourceGameId);
      added.push(row);
    },
  };
}

/** appdetails, stubbed: appId → { name, type }. */
function withAppDetails(byId, fn, spy) {
  return withFetch(async (url) => {
    const appId = new URL(String(url)).searchParams.get('appids');
    spy?.push({ appId, at: Date.now() });
    const info = byId[appId];
    if (!info) return new Response(JSON.stringify({ [appId]: { success: false } }), { status: 200 });
    return new Response(
      JSON.stringify({ [appId]: { success: true, data: { name: info.name, type: info.type ?? 'game' } } }),
      { status: 200 }
    );
  }, fn);
}

const entries = (...ids) => ids.map((id, i) => ({ appId: String(id), addedAt: 1000 - i }));

test('games are tracked and add-ons are not', async () => {
  // A wishlist is full of DLC, and fifteen "Cosmetic Pack" rows in a price
  // tracker is exactly the noise the DLC filter exists to keep off the board.
  const sink = fakeSink();
  const out = await withAppDetails(
    {
      1: { name: 'A Real Game' },
      2: { name: 'A Real Game — Season Pass', type: 'dlc' },
      3: { name: 'A Demo', type: 'demo' },
    },
    () => importWishlist(entries(1, 2, 3), sink, undefined, 0)
  );
  assert.equal(out.added, 1);
  assert.equal(out.nonGames, 2);
  assert.deepEqual(sink.added.map((r) => r.title), ['A Real Game']);
  assert.deepEqual(sink.added[0].refs, [{ sourceId: 'steam-regional', sourceGameId: '1' }]);
  assert.equal(sink.added[0].platform, 'pc');
});

test('re-importing costs nothing for what is already tracked', async () => {
  const spy = [];
  const sink = fakeSink(['1', '2']);
  const out = await withAppDetails(
    { 1: { name: 'One' }, 2: { name: 'Two' }, 3: { name: 'Three' } },
    () => importWishlist(entries(1, 2, 3), sink, undefined, 0),
    spy
  );
  assert.equal(out.skipped, 2);
  assert.equal(out.added, 1);
  assert.deepEqual(spy.map((s) => s.appId), ['3'], 'a skipped game must not cost Steam a request');
});

test('an app Steam will not describe is counted, not invented', async () => {
  // Delisted and region-locked apps sit on old wishlists. Tracking one under a
  // made-up title would be worse than admitting we could not resolve it.
  const sink = fakeSink();
  const out = await withAppDetails({ 1: { name: 'One' } }, () =>
    importWishlist(entries(1, 999), sink, undefined, 0)
  );
  assert.equal(out.added, 1);
  assert.equal(out.unresolved, 1);
  assert.equal(sink.added.length, 1);
});

test('progress is reported per game, so a minutes-long import can show itself', async () => {
  const steps = [];
  const sink = fakeSink();
  await withAppDetails({ 1: { name: 'One' }, 2: { name: 'Two' } }, () =>
    importWishlist(entries(1, 2), sink, (p) => steps.push(p), 0)
  );
  assert.deepEqual(steps.map((s) => s.done), [1, 2]);
  assert.equal(steps[0].total, 2);
  assert.equal(steps[1].title, 'Two', 'the step names what it just resolved');
});

test('titles are fetched one at a time, with a gap — never all at once', async () => {
  // The whole point of this project is that it is a guest on other people's
  // servers, and an import is the easiest moment to stop being one. A refactor
  // to Promise.all would pass every other test in this file.
  const spy = [];
  const sink = fakeSink();
  await withAppDetails(
    { 1: { name: 'One' }, 2: { name: 'Two' }, 3: { name: 'Three' } },
    () => importWishlist(entries(1, 2, 3), sink, undefined, 30),
    spy
  );
  assert.deepEqual(spy.map((s) => s.appId), ['1', '2', '3'], 'in order, not in parallel');
  const gaps = spy.slice(1).map((s, i) => s.at - spy[i].at);
  assert.ok(
    gaps.every((g) => g >= 25),
    `each request must wait for the last (gaps: ${gaps.join(', ')})`
  );
});
