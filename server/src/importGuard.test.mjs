import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeImport } from './importGuard.ts';

test('a clean, legitimate file passes through intact', () => {
  const [item] = sanitizeImport({
    items: [
      {
        title: 'Elden Ring',
        platform: 'ps5',
        image: 'https://cdn.example.com/art.jpg',
        refs: [{ sourceId: 'psn-store', sourceGameId: 'ELDENRING00000~Elden%20Ring' }],
        preferred_region: 'TR',
        hide_desc: 1,
        added_at: '2026-07-01 10:00:00',
        history: [
          { store: 'PSN 🇹🇷', region: 'TR', kind: 'digital', price: 1399.5, currency: 'TRY', price_ils: 155, checked_at: '2026-07-01 10:00:00' },
        ],
      },
    ],
  });
  assert.equal(item.title, 'Elden Ring');
  assert.equal(item.preferred_region, 'TR');
  assert.equal(item.hide_desc, 1);
  assert.equal(item.refs.length, 1);
  assert.equal(item.history.length, 1);
});

test('accepts a bare array as well as { items: [...] }', () => {
  const out = sanitizeImport([{ title: 'Hades', platform: 'pc', history: [] }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Hades');
});

test('drops rows with an unknown platform or no title', () => {
  const out = sanitizeImport([
    { title: 'X', platform: 'dreamcast' }, // not a platform we support
    { title: '', platform: 'pc' }, // no title
    { platform: 'pc' }, // no title field
    { title: 'Ok', platform: 'switch' }, // keeper
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Ok');
});

test('strips refs that would drive an SSRF (bad host) or use an unknown source', () => {
  const [item] = sanitizeImport([
    {
      title: 'Evil',
      platform: 'ps4',
      refs: [
        { sourceId: 'arcadia', sourceGameId: 'http://169.254.169.254/latest/meta-data/' }, // SSRF host
        { sourceId: 'arcadia', sourceGameId: 'http://127.0.0.1:6379/' }, // SSRF host
        { sourceId: 'totally-made-up', sourceGameId: 'https://arcadia.co.il/x' }, // unknown source
        { sourceId: 'arcadia', sourceGameId: 'https://arcadia.co.il/product/ok' }, // legit — kept
        { sourceId: 'steam-regional', sourceGameId: '1245620' }, // opaque id — kept
      ],
    },
  ]);
  assert.equal(item.refs.length, 2);
  assert.deepEqual(item.refs.map((r) => r.sourceId).sort(), ['arcadia', 'steam-regional']);
});

test('rejects a javascript: image and non-numeric / negative prices', () => {
  const [item] = sanitizeImport([
    {
      title: 'Bad Data',
      platform: 'pc',
      image: 'javascript:alert(document.cookie)',
      history: [
        { store: 'A', price: 'not-a-number', currency: 'ILS', price_ils: 10, checked_at: '2026-07-01 10:00:00' }, // bad price
        { store: 'B', price: -5, currency: 'ILS', price_ils: 10, checked_at: '2026-07-01 10:00:00' }, // negative
        { store: '', price: 10, currency: 'ILS', price_ils: 10, checked_at: '2026-07-01 10:00:00' }, // no store
        { store: 'C', price: 10, currency: 'ILS', price_ils: 10, checked_at: '2026-07-01 10:00:00' }, // keeper
      ],
    },
  ]);
  assert.equal(item.image, null);
  assert.equal(item.history.length, 1);
  assert.equal(item.history[0].store, 'C');
});

test('caps a hostile file so it cannot exhaust memory', () => {
  // Timestamps must be valid, or the points are dropped before the caps are
  // exercised and the assertions below pass vacuously on an empty history.
  const huge = { title: 'Flood', platform: 'pc', history: Array.from({ length: 100_000 }, () => ({ store: 'S', price: 1, currency: 'ILS', price_ils: 1, checked_at: '2026-07-01 10:00:00' })) };
  const items = Array.from({ length: 50_000 }, () => huge);
  const out = sanitizeImport(items);
  assert.ok(out.length <= 5000, `items capped, got ${out.length}`);
  assert.ok(out[0].history.length > 0, 'history survived the sanitiser');
  assert.ok(out[0].history.length <= 20_000, `history capped, got ${out[0].history.length}`);
});

test('non-object / garbage input yields an empty list, never throws', () => {
  assert.deepEqual(sanitizeImport(null), []);
  assert.deepEqual(sanitizeImport('a string'), []);
  assert.deepEqual(sanitizeImport(42), []);
  assert.deepEqual(sanitizeImport({ nope: true }), []);
});

test('a non-timestamp checked_at is dropped, not stored', () => {
  // Timestamps are compared as TEXT ("MAX(checked_at)", "ORDER BY checked_at
  // DESC"), so "~evil" would outrank every real one and become the "latest"
  // check — poisoning the wishlist's current price and the sale-alert baseline.
  const [item] = sanitizeImport({
    items: [
      {
        title: 'Hades',
        platform: 'pc',
        history: [
          { store: 'Steam', price: 10, currency: 'USD', price_ils: 37, checked_at: '~evil' },
          { store: 'Steam', price: 10, currency: 'USD', price_ils: 37, checked_at: 'yesterday' },
          { store: 'Steam', price: 10, currency: 'USD', price_ils: 37, checked_at: '2026-07-01 10:00:00' },
        ],
      },
    ],
  });
  assert.equal(item.history.length, 1);
  assert.equal(item.history[0].checked_at, '2026-07-01 10:00:00');
});

test('ISO-8601 timestamps are normalised to the sortable storage form', () => {
  // A hand-made or third-party file uses ISO-8601; stored verbatim it sorts
  // after our space-separated form for the same instant ("T" > " ").
  const [item] = sanitizeImport({
    items: [
      {
        title: 'Hades',
        platform: 'pc',
        history: [
          { store: 'Steam', price: 10, currency: 'USD', price_ils: 37, checked_at: '2026-07-01T10:00:00.000Z' },
        ],
      },
    ],
  });
  assert.equal(item.history[0].checked_at, '2026-07-01 10:00:00');
});
