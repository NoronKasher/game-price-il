import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The sync mirror, without a browser.
 *
 * These are the cases that decide whether somebody's tracked list survives a new
 * machine, and every one of them is invisible until it is too late — a list that
 * silently failed to sync looks exactly like a list nobody added anything to.
 * Chrome's sync area has hard limits (8KB an item, 100KB in total), so the
 * chunking and the leftover-chunk cleanup are load-bearing, not housekeeping.
 */

/* ── Enough of chrome.storage.sync and IndexedDB to run against ──────────── */

let syncData = {};

globalThis.chrome = {
  runtime: { lastError: undefined },
  storage: {
    sync: {
      get(keys, cb) {
        if (keys === null || keys === undefined) return cb({ ...syncData });
        const out = {};
        for (const k of keys) if (k in syncData) out[k] = syncData[k];
        cb(out);
      },
      set(values, cb) {
        Object.assign(syncData, values);
        cb();
      },
      remove(keys, cb) {
        for (const k of keys) delete syncData[k];
        cb();
      },
    },
    onChanged: { addListener() {} },
  },
};

// db.browser writes through to IndexedDB after every change. The tests seed the
// tables directly, so all this has to do is accept the write without exploding.
globalThis.indexedDB = {
  open() {
    const req = {};
    queueMicrotask(() => {
      req.result = {
        objectStoreNames: { contains: () => true },
        transaction: () => ({
          objectStore: () => ({
            put: () => ({}),
            get: () => {
              const r = {};
              queueMicrotask(() => r.onsuccess?.());
              return r;
            },
          }),
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
const mirror = await import('./syncMirror.ts');

function seed(titles) {
  db.__setTables({});
  for (const title of titles) {
    db.addToWishlist({
      title,
      platform: 'pc',
      image: `https://example.test/${encodeURIComponent(title)}.jpg`,
      refs: [{ sourceId: 'steam-regional', sourceGameId: `${title}~1` }],
    });
  }
}

function fresh() {
  syncData = {};
  mirror.__resetSyncState();
}

/* ── The tests ───────────────────────────────────────────────────────────── */

test('a tracked list pushed from one machine arrives on another', async () => {
  fresh();
  seed(['Elden Ring', 'Hades II']);
  await mirror.pushToSync();

  // A different machine: same synced data, nothing local.
  db.__setTables({});
  mirror.__resetSyncState();
  const { games } = await mirror.pullFromSync();

  assert.equal(games, 2);
  assert.deepEqual(
    db.listWishlist().map((r) => r.title).sort(),
    ['Elden Ring', 'Hades II']
  );
});

test('price history is never sent — it does not fit, and pretending it does would lose most of it', async () => {
  fresh();
  seed(['Elden Ring']);
  const row = db.listWishlist()[0];
  db.recordOffers(row.id, [
    { store: 'Steam', region: 'IL', kind: 'digital', price: 199, currency: 'ILS', priceILS: 199 },
  ]);
  await mirror.pushToSync();

  const stored = Object.entries(syncData)
    .filter(([k]) => k.startsWith('vgpt_sync_'))
    .map(([, v]) => v)
    .join('');
  assert.ok(stored.includes('Elden Ring'), 'the game itself is synced');
  assert.ok(!stored.includes('"Steam"'), 'its price history is not');
});

test('a list too big for one item is split, and reassembles exactly', async () => {
  fresh();
  // Each title carries a long image URL and a ref, so a few dozen exceed 8KB.
  seed(Array.from({ length: 60 }, (_, i) => `Game Number ${i} ${'x'.repeat(120)}`));
  await mirror.pushToSync();

  const meta = syncData.vgpt_sync_meta;
  assert.ok(meta.chunks > 1, `expected more than one chunk, got ${meta.chunks}`);
  assert.equal(meta.dropped, 0);
  for (let i = 0; i < meta.chunks; i++) {
    assert.ok(syncData[`vgpt_sync_${i}`].length <= 8192, `chunk ${i} exceeds chrome's per-item limit`);
  }

  db.__setTables({});
  mirror.__resetSyncState();
  const { games } = await mirror.pullFromSync();
  assert.equal(games, 60);
});

test('shrinking the list removes the chunks it no longer needs', async () => {
  fresh();
  seed(Array.from({ length: 60 }, (_, i) => `Game Number ${i} ${'x'.repeat(120)}`));
  await mirror.pushToSync();
  const before = syncData.vgpt_sync_meta.chunks;
  assert.ok(before > 1);

  seed(['Just One']);
  mirror.__resetSyncState();
  await mirror.pushToSync();

  const after = syncData.vgpt_sync_meta.chunks;
  assert.ok(after < before);
  // A leftover chunk would be read back as trailing garbage and break the parse.
  for (let i = after; i < before; i++) {
    assert.ok(!(`vgpt_sync_${i}` in syncData), `chunk ${i} was left behind`);
  }
  db.__setTables({});
  mirror.__resetSyncState();
  assert.equal((await mirror.pullFromSync()).games, 1);
});

test('a pull adds what is missing and never removes what is here', async () => {
  fresh();
  seed(['Elden Ring']);
  await mirror.pushToSync();

  // This machine tracks something the other one has never seen.
  seed(['Stardew Valley']);
  mirror.__resetSyncState();
  await mirror.pullFromSync();

  assert.deepEqual(
    db.listWishlist().map((r) => r.title).sort(),
    ['Elden Ring', 'Stardew Valley'],
    'the local game must survive a pull'
  );
});

test('a list beyond the quota syncs what fits and says how much it left', async () => {
  fresh();
  seed(Array.from({ length: 400 }, (_, i) => `Game ${i} ${'y'.repeat(200)}`));
  await mirror.pushToSync();

  const meta = syncData.vgpt_sync_meta;
  assert.ok(meta.dropped > 0, 'the overflow has to be reported, not silently lost');
  const total = Object.entries(syncData)
    .filter(([k]) => k.startsWith('vgpt_sync_') && k !== 'vgpt_sync_meta')
    .reduce((n, [k, v]) => n + k.length + String(v).length, 0);
  assert.ok(total < 102_400, `stored ${total} bytes, over chrome's total quota`);
});

test('a note survives export and import in the extension too', async () => {
  // The divergence this catches was invisible: the server's exportAll carried
  // the note and the extension's did not, so a token made in the EXTENSION
  // silently dropped every note while one made on the desktop kept them.
  // Nothing failed — the notes were simply not in the string.
  db.__setTables({});
  const row = db.addToWishlist({
    title: 'Noted Game',
    platform: 'pc',
    refs: [{ sourceId: 'steam-regional', sourceGameId: '1' }],
  });
  db.setNote(row.id, '<b>wait for the GOTY</b>');

  const exported = db.exportAll();
  assert.equal(exported[0].note, '<b>wait for the GOTY</b>', 'the export has to carry it');

  db.__setTables({});
  db.importAll(exported);
  assert.equal(db.listWishlist()[0].note, '<b>wait for the GOTY</b>', 'and the import has to restore it');
});

test('a hostile note in an imported file is sanitised on the way in', async () => {
  // A shared file and a pasted token are exactly as untrusted as a web page.
  db.__setTables({});
  db.importAll([
    {
      title: 'From Somebody Else',
      platform: 'pc',
      refs: [{ sourceId: 'steam-regional', sourceGameId: '2' }],
      note: '<img src=x onerror="alert(1)"><script>alert(2)</script>ok',
      history: [],
    },
  ]);
  const note = db.listWishlist()[0].note ?? '';
  assert.ok(!/onerror|script|alert/i.test(note), `survived: ${note}`);
  assert.match(note, /ok/, 'the words still arrive');
});
