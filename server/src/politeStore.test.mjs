import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The server's rate limits, across a restart.
 *
 * politeFetch's own tests prove the RULES survive a restart given a store that
 * remembers; these prove the server actually has one. That distinction is the
 * whole bug: the rules were always right, and the server was handing itself a
 * clean slate every time it started — so a daily budget lasted until the next
 * restart, and a shop that asked us to wait an hour was obeyed until then too.
 */

let n = 0;
async function freshModules() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgpt-polite-'));
  process.env.VGPT_DATA_DIR = dir;
  const tag = `case=${n++}`;
  const store = await import(`./politeStore.ts?${tag}`);
  const polite = await import(`./adapters/politeFetch.ts?${tag}`);
  return { dir, store: store.sqlitePoliteStore, polite };
}

const today = () => new Date().toISOString().slice(0, 10);

test('a spent budget is still spent after the server restarts', async () => {
  const first = await freshModules();
  await first.store.set('player1.co.il', { day: today(), count: 200, pausedUntil: 0, lastAt: Date.now() });

  // A new process: new module instances, same data directory.
  const tag = `case=${n++}`;
  process.env.VGPT_DATA_DIR = first.dir;
  const { sqlitePoliteStore: afterRestart } = await import(`./politeStore.ts?${tag}`);

  const state = await afterRestart.get('player1.co.il');
  assert.equal(state.count, 200, 'the count must not reset to zero on restart');
  assert.equal(state.day, today());
});

test("a shop's stand-down outlives the process that was told about it", async () => {
  const { store, dir } = await freshModules();
  const until = Date.now() + 45 * 60 * 1000;
  await store.set('vgs.co.il', { day: today(), count: 12, pausedUntil: until, lastAt: Date.now() });

  process.env.VGPT_DATA_DIR = dir;
  const { sqlitePoliteStore: afterRestart } = await import(`./politeStore.ts?case=${n++}`);
  const state = await afterRestart.get('vgs.co.il');
  assert.equal(state.pausedUntil, until, 'a 429 back-off must not be forgotten by restarting');
});

test('hosts are kept apart', async () => {
  const { store } = await freshModules();
  await store.set('a.example', { day: today(), count: 5, pausedUntil: 0, lastAt: 1 });
  await store.set('b.example', { day: today(), count: 99, pausedUntil: 0, lastAt: 2 });
  assert.equal((await store.get('a.example')).count, 5);
  assert.equal((await store.get('b.example')).count, 99);
  assert.equal(await store.get('c.example'), null);
});

test('a corrupt row reads as absent rather than disabling the limits', async () => {
  const { store, dir } = await freshModules();
  process.env.VGPT_DATA_DIR = dir;
  const { setSetting } = await import(`./db.ts?case=${n++}`);
  setSetting('polite:broken.example', '{not json');
  // Absent means "no state yet", which politeFetch treats as a fresh host — the
  // safe reading. Returning a half-built object could mean an unlimited one.
  assert.equal(await store.get('broken.example'), null);
});

test('the persisted state is what politeFetch actually asks for', async () => {
  const { store, polite } = await freshModules();
  polite.setPoliteStore(store);

  // A host we have already exhausted today: the request must be refused by us,
  // without a single call reaching the network. It has to be one the tool is
  // allowed to scrape at all — politeFetch rejects anything outside that
  // allowlist before it ever looks at a budget.
  await store.set('vgs.co.il', { day: today(), count: 200, pausedUntil: 0, lastAt: Date.now() - 60_000 });

  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetched++;
    return new Response('', { status: 200 });
  };
  try {
    await assert.rejects(
      () => polite.politeFetch('https://vgs.co.il/game'),
      (err) => err instanceof polite.RateLimitedError
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(fetched, 0, 'a spent budget must stop the request, not just record it');
});
