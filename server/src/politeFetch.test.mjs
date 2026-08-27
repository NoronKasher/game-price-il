import test from 'node:test';
import assert from 'node:assert/strict';
import { setPoliteStore, politeFetch, RateLimitedError } from './adapters/politeFetch.ts';

/**
 * The point of these tests is the MV3 service worker, which is killed after
 * ~30s idle and restarted on the next event. Everything politeFetch promises a
 * store — 2.5s spacing, a daily budget, standing down after a 429 — lived in
 * process memory, which a restart wipes. A scraper that quietly forgets it was
 * told to stop is the exact failure this module exists to prevent, so the
 * guarantee has to hold across a restart, not merely within one.
 *
 * "Restarting the worker" here means throwing away every in-memory structure
 * and re-reading the state from the store, which is what actually happens.
 */

/** A store that survives the module's memory, like chrome.storage does. */
function persistentStore() {
  const rows = new Map();
  return {
    rows,
    async get(host) {
      const raw = rows.get(host);
      return raw ? JSON.parse(raw) : null;
    },
    async set(host, state) {
      // Serialized on purpose: chrome.storage hands back a copy, never the same
      // object, so a test sharing an object reference would prove nothing.
      rows.set(host, JSON.stringify(state));
    },
  };
}

const HOST = 'https://vgs.co.il';

/** Swap global fetch for the duration of one test. */
async function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

const ok = (body = '<html>hi</html>') =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

test('a back-off survives a service-worker restart', async () => {
  const store = persistentStore();
  setPoliteStore(store);

  // The store answers 429 — politeFetch must stand this host down.
  await withFetch(
    async () => new Response('slow down', { status: 429 }),
    async () => {
      await assert.rejects(() => politeFetch(`${HOST}/a`), RateLimitedError);
    }
  );

  const saved = await store.get('vgs.co.il');
  assert.ok(saved.pausedUntil > Date.now(), 'back-off should be recorded in the store');

  // Restart: a brand-new store object holding the same persisted rows is exactly
  // what a fresh worker sees. If the pause only lived in memory, the next call
  // would sail through and hit a store that just asked us to stop.
  const afterRestart = persistentStore();
  afterRestart.rows.set('vgs.co.il', store.rows.get('vgs.co.il'));
  setPoliteStore(afterRestart);

  let called = false;
  await withFetch(
    async () => {
      called = true;
      return ok();
    },
    async () => {
      await assert.rejects(() => politeFetch(`${HOST}/b`), RateLimitedError);
    }
  );
  assert.equal(called, false, 'a restarted worker must not request from a backed-off host');
});

test('the daily budget is not reset by a restart', async () => {
  const store = persistentStore();
  setPoliteStore(store);
  const day = new Date().toISOString().slice(0, 10);
  // Pretend today's budget is already spent.
  store.rows.set('vgs.co.il', JSON.stringify({ day, count: 200, pausedUntil: 0, lastAt: 0 }));

  let called = false;
  await withFetch(
    async () => {
      called = true;
      return ok();
    },
    async () => {
      await assert.rejects(() => politeFetch(`${HOST}/c`), RateLimitedError);
    }
  );
  assert.equal(called, false, 'a spent budget must still be spent after a restart');
});

test('spacing is honoured across a restart', async () => {
  const store = persistentStore();
  setPoliteStore(store);
  const day = new Date().toISOString().slice(0, 10);
  // A request went out 200ms ago and then the worker died.
  store.rows.set(
    'vgs.co.il',
    JSON.stringify({ day, count: 1, pausedUntil: 0, lastAt: Date.now() - 200 })
  );

  const started = Date.now();
  await withFetch(
    async () => ok(),
    async () => {
      await politeFetch(`${HOST}/d`);
    }
  );
  const waited = Date.now() - started;
  // 2500ms interval, 200ms already elapsed — it must wait out the remainder
  // rather than firing immediately because its in-memory queue is empty.
  assert.ok(waited >= 2000, `expected to wait out the interval, waited ${waited}ms`);
});

test('a new day resets the count but not an active back-off', async () => {
  const store = persistentStore();
  setPoliteStore(store);
  const pausedUntil = Date.now() + 60_000;
  store.rows.set(
    'vgs.co.il',
    JSON.stringify({ day: '2000-01-01', count: 200, pausedUntil, lastAt: 0 })
  );

  let called = false;
  await withFetch(
    async () => {
      called = true;
      return ok();
    },
    async () => {
      await assert.rejects(() => politeFetch(`${HOST}/e`), RateLimitedError);
    }
  );
  assert.equal(called, false, 'midnight is not permission to ignore a stand-down');
});

/* ── SSRF via redirect ───────────────────────────────────────────────────── */

test('a redirect off the allowlist is refused, not followed', async () => {
  // The hole that `redirect: 'follow'` left wide open. The guard checks the URL
  // we ASK for; fetch then silently follows wherever the answer points, and the
  // final request is the one that actually happens. A store answering with
  // `Location: http://127.0.0.1:6379/` — or the cloud metadata address — turned
  // this server into the SSRF proxy the allowlist exists to prevent.
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    if (String(url).includes('vgs.co.il')) {
      return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:6379/' } });
    }
    return new Response('SHOULD NEVER BE REACHED', { status: 200 });
  };
  try {
    await assert.rejects(
      () => politeFetch('https://www.vgs.co.il/product/1'),
      /disallowed URL/,
      'the redirect target must be refused'
    );
    assert.equal(asked.length, 1, 'and the disallowed host must never be contacted at all');
    assert.ok(!asked.some((u) => u.includes('127.0.0.1')));
  } finally {
    globalThis.fetch = real;
  }
});

test('a redirect that stays on the allowlist is followed', async () => {
  // http → https, or /product/1 → /products/1. Refusing these would break the
  // stores rather than protect anybody.
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/old')) {
      return new Response(null, { status: 301, headers: { location: 'https://www.vgs.co.il/new' } });
    }
    return new Response('the real page', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  try {
    assert.match(await politeFetch('https://www.vgs.co.il/old'), /the real page/);
  } finally {
    globalThis.fetch = real;
  }
});

test('a redirect loop ends in an error rather than a hang', async () => {
  const real = globalThis.fetch;
  let hops = 0;
  globalThis.fetch = async () => {
    hops++;
    return new Response(null, { status: 302, headers: { location: 'https://www.vgs.co.il/loop' } });
  };
  try {
    await assert.rejects(() => politeFetch('https://www.vgs.co.il/loop'), /too many redirects/);
    assert.ok(hops <= 6, `capped, not endless (made ${hops} requests)`);
  } finally {
    globalThis.fetch = real;
  }
});
