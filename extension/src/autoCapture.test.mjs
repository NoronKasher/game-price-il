import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The extension's background capture.
 *
 * Worth pinning down because the failure mode is silence. A scheduler that never
 * fires, or fires and records nothing, looks exactly like a tracked list nobody
 * happened to change — the history simply has holes where nobody was looking,
 * which is precisely where this feature is supposed to be working.
 */

/* ── Enough of the extension platform to run against ─────────────────────── */

let alarms = new Map();
let created = [];
let badge = null;
const platformCalls = { n: 0 };

globalThis.chrome = {
  runtime: {
    lastError: undefined,
    getPlatformInfo: async () => {
      platformCalls.n++;
      return { os: 'win' };
    },
  },
  alarms: {
    get(name, cb) {
      cb(alarms.get(name));
    },
    create(name, info) {
      created.push({ name, info });
      alarms.set(name, { name, ...info });
    },
    onAlarm: { addListener() {} },
  },
  action: {
    setBadgeText: async ({ text }) => {
      badge = text;
    },
    setBadgeBackgroundColor: async () => {},
    setBadgeTextColor: async () => {},
  },
  storage: {
    sync: { get: (_k, cb) => cb({}), set: (_v, cb) => cb(), remove: (_k, cb) => cb() },
    // Promise-based, like the real one: staleReminder.ts awaits it to remember
    // which rows it has already nagged about. A shim without `local` made every
    // pass look like the first.
    local: (() => {
      const store = new Map();
      return {
        async get(key) {
          return store.has(key) ? { [key]: store.get(key) } : {};
        },
        async set(values) {
          for (const [k, v] of Object.entries(values)) store.set(k, v);
        },
        _reset: () => store.clear(),
      };
    })(),
    onChanged: { addListener() {} },
  },
};

globalThis.indexedDB = {
  open() {
    const req = {};
    queueMicrotask(() => {
      req.result = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({
          objectStore: () => ({ put: () => ({}), get: () => ({}) }),
          set oncomplete(fn) {
            queueMicrotask(fn);
          },
          set onerror(_fn) {},
        }),
      };
      req.onsuccess?.();
    });
    return req;
  },
};

const db = await import('./db.browser.ts');
const { runAutoCapture, startAutoCapture } = await import('./autoCapture.ts');
const { isCaptureDue } = await import('../../server/src/capture.ts');

/** "YYYY-MM-DD HH:MM:SS" in UTC — the shape checked_at is stored in. */
const ago = (days) =>
  new Date(Date.now() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);

/** A source that always answers with one offer, and counts how often it is asked. */
function fakeSource(id, price, calls) {
  return {
    id,
    name: id,
    nameHe: id,
    platforms: ['pc'],
    enabled: true,
    async search() {
      return [];
    },
    async getOffers() {
      calls.push(id);
      return [
        {
          store: 'Steam',
          kind: 'digital',
          location: 'international',
          price,
          currency: 'ILS',
          priceILS: price,
        },
      ];
    },
  };
}

function seed(games) {
  db.__setTables({});
  for (const g of games) {
    const row = db.addToWishlist({
      title: g.title,
      platform: 'pc',
      refs: [{ sourceId: 'steam-regional', sourceGameId: '1' }],
    });
    if (g.lastCheckedDaysAgo != null) {
      db.recordOffers(
        row.id,
        [{ store: 'Steam', region: null, kind: 'digital', price: 100, currency: 'ILS', priceILS: 100 }],
        ago(g.lastCheckedDaysAgo)
      );
    }
    if (g.captureDays != null) db.setCaptureDays(row.id, g.captureDays);
  }
}

/* ── The due rule, shared with the server's scheduler ────────────────────── */

test('a game never checked is due; one checked today is not', () => {
  assert.equal(isCaptureDue(null, null, 7), true);
  assert.equal(isCaptureDue(ago(0), null, 7), false);
  assert.equal(isCaptureDue(ago(8), null, 7), true);
});

test("a game's own interval overrides the global default", () => {
  // Global says weekly, this game says daily: two days is overdue.
  assert.equal(isCaptureDue(ago(2), 1, 7), true);
  // Global says daily, this game says monthly: two days is not.
  assert.equal(isCaptureDue(ago(2), 30, 1), false);
});

test('an unparseable timestamp is treated as due rather than never', () => {
  // Failing open matters here: the alternative is a game that silently stops
  // being checked forever because one row is malformed.
  assert.equal(isCaptureDue('not a date', null, 7), true);
});

/* ── The run ─────────────────────────────────────────────────────────────── */

test('only games past their interval are re-priced', async () => {
  seed([
    { title: 'Due Game', lastCheckedDaysAgo: 9 },
    { title: 'Fresh Game', lastCheckedDaysAgo: 1 },
    { title: 'Never Checked' },
  ]);
  const calls = [];
  const result = await runAutoCapture([fakeSource('steam-regional', 149, calls)]);

  assert.equal(result.due, 2, 'the game checked yesterday must be left alone');
  assert.equal(result.checked, 2);
  assert.equal(calls.length, 2, 'one store request per due game, and no more');
});

test('nothing due means no store is touched at all', async () => {
  seed([{ title: 'Fresh Game', lastCheckedDaysAgo: 1 }]);
  const calls = [];
  const result = await runAutoCapture([fakeSource('steam-regional', 149, calls)]);
  assert.deepEqual(result, { checked: 0, due: 0 });
  assert.equal(calls.length, 0);
});

test('a due game gains a real history point', async () => {
  seed([{ title: 'Due Game', lastCheckedDaysAgo: 9 }]);
  const row = db.listWishlist()[0];
  const before = db.fullOfferHistory(row.id).length;
  await runAutoCapture([fakeSource('steam-regional', 149, [])]);
  const after = db.fullOfferHistory(row.id);
  assert.ok(after.length > before, 'the capture has to actually record something');
  assert.ok(after.some((p) => p.price_ils === 149));
});

test('an empty scrape records nothing — an outage is not a price', async () => {
  seed([{ title: 'Due Game', lastCheckedDaysAgo: 9 }]);
  const row = db.listWishlist()[0];
  const before = db.fullOfferHistory(row.id).length;
  const dead = {
    id: 'steam-regional',
    name: 'x',
    nameHe: 'x',
    platforms: ['pc'],
    enabled: true,
    async search() {
      return [];
    },
    async getOffers() {
      return [];
    },
  };
  const result = await runAutoCapture([dead]);
  assert.equal(result.checked, 0, 'a store returning nothing must not count as a check');
  assert.equal(db.fullOfferHistory(row.id).length, before, 'and must not add a phantom point');
});

test('one failing store does not abandon the rest of the list', async () => {
  seed([
    { title: 'Broken', lastCheckedDaysAgo: 9 },
    { title: 'Fine', lastCheckedDaysAgo: 9 },
  ]);
  const rows = db.listWishlist();
  let first = true;
  const flaky = {
    id: 'steam-regional',
    name: 'x',
    nameHe: 'x',
    platforms: ['pc'],
    enabled: true,
    async search() {
      return [];
    },
    async getOffers() {
      if (first) {
        first = false;
        throw new Error('store is down');
      }
      return [
        { store: 'Steam', kind: 'digital', location: 'international', price: 99, currency: 'ILS', priceILS: 99 },
      ];
    },
  };
  const result = await runAutoCapture([flaky]);
  assert.equal(result.due, 2);
  assert.equal(result.checked, 1, 'the second game must still be captured');
  const captured = rows.filter((r) => db.fullOfferHistory(r.id).some((p) => p.price_ils === 99));
  assert.equal(captured.length, 1);
});

/* ── The scheduling trap ─────────────────────────────────────────────────── */

test('the alarm is not re-created on every service-worker restart', () => {
  alarms = new Map();
  created = [];

  startAutoCapture([]);
  assert.equal(created.length, 1, 'the first start has to create the alarm');

  // The worker is killed and restarts — this module is evaluated again. Creating
  // unconditionally would restart the six-hour period from now every time, so on
  // a busy browser the alarm would never actually come due.
  startAutoCapture([]);
  startAutoCapture([]);
  assert.equal(created.length, 1, 'an existing alarm must be left alone');
});

test('the created alarm looks soon and then repeats', () => {
  alarms = new Map();
  created = [];
  startAutoCapture([]);
  const { info } = created[0];
  assert.ok(info.delayInMinutes > 0 && info.delayInMinutes <= 5, 'a new install should not wait hours');
  assert.equal(info.periodInMinutes, 360);
});

/* ── Rows only a person can refresh ──────────────────────────────────────── */

test('a stale page-read row is reminded about, not fetched', async () => {
  const { remindAboutStaleRows } = await import('./staleReminder.ts');
  chrome.storage.local._reset();
  db.__setTables({});
  const row = db.addToWishlist({
    title: 'Some Amazon Thing',
    platform: 'other',
    refs: [{ sourceId: 'amazon-page', sourceGameId: 'B0TEST12345' }],
  });
  db.recordOffers(
    row.id,
    [{ store: 'Amazon', region: null, kind: 'physical', price: 40, currency: 'USD', priceILS: 160 }],
    ago(30)
  );

  const raised = await remindAboutStaleRows();
  assert.equal(raised, 1, 'a month-old page-read row should be reminded about');
  const notes = db.listNotifications();
  assert.equal(notes[0].kind, 'stale');
  assert.match(notes[0].message, /amazon\.com\/dp\/B0TEST12345/, 'the reminder has to be actionable');
});

test('the same staleness is not reminded about twice', async () => {
  // A nag every six hours is how a bell gets ignored.
  const { remindAboutStaleRows } = await import('./staleReminder.ts');
  chrome.storage.local._reset();
  db.__setTables({});
  const row = db.addToWishlist({
    title: 'Some Amazon Thing',
    platform: 'other',
    refs: [{ sourceId: 'amazon-page', sourceGameId: 'B0TEST12345' }],
  });
  db.recordOffers(
    row.id,
    [{ store: 'Amazon', region: null, kind: 'physical', price: 40, currency: 'USD', priceILS: 160 }],
    ago(30)
  );
  assert.equal(await remindAboutStaleRows(), 1);
  assert.equal(await remindAboutStaleRows(), 0, 'the second pass should stay quiet');
});

test('a game that other sources can refresh is never reminded about', async () => {
  // Only rows whose EVERY source is unreachable. A game also on Steam gets
  // re-priced by the ordinary capture and needs no nagging.
  const { remindAboutStaleRows } = await import('./staleReminder.ts');
  chrome.storage.local._reset();
  db.__setTables({});
  const row = db.addToWishlist({
    title: 'Normal Game',
    platform: 'pc',
    refs: [
      { sourceId: 'amazon-page', sourceGameId: 'B0TEST12345' },
      { sourceId: 'steam-regional', sourceGameId: '1245620' },
    ],
  });
  db.recordOffers(
    row.id,
    [{ store: 'Steam', region: 'IL', kind: 'digital', price: 40, currency: 'ILS', priceILS: 40 }],
    ago(30)
  );
  assert.equal(await remindAboutStaleRows(), 0);
});
