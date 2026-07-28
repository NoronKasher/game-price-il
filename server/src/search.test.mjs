// Tests for parseQuery (game-price-il search-query parser).
// Plain JS, node:test + node:assert only. Run with a TS-capable runner, e.g.:
//   npx tsx --test server/src/search.test.mjs
//
// Documented expected behavior:
//  1. "FIFA 2020 PS4"            -> { title: "FIFA 2020", platforms: ["ps4"] }
//  2. "fifa 2020"                -> { title: "fifa 2020", platforms: [] } (no filter)
//  3. "elden ring xbox series x" -> { title: "elden ring", platforms: ["xbox-series"] } (no stray "x")
//  4. "halo xbox"                -> bare "xbox" means BOTH ["xbox-series", "xbox-one"]
//  5. "פיפא פלייסטיישן 5"        -> Hebrew multi-word token -> ["ps5"]
//  6. "gta פלייסטיישן"           -> bare "playstation" (Hebrew) -> BOTH ["ps5", "ps4"]
//  7. "pspice simulator"         -> word boundaries: "pspice" must NOT match "ps"
//  8. "zelda nintendo switch"    -> longest-first: consumes both words -> ["switch"]
//  9. "  doom   PC  steam "      -> case-insensitive, dedup, whitespace collapse -> { "doom", ["pc"] }
// 10. ""                         -> { title: "", platforms: [] }

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from './search.ts';

test('English platform token is extracted and removed', () => {
  assert.deepEqual(parseQuery('FIFA 2020 PS4'), {
    title: 'FIFA 2020',
    platforms: ['ps4'],
  });
});

test('query with no platform tokens returns empty platform filter', () => {
  assert.deepEqual(parseQuery('fifa 2020'), {
    title: 'fifa 2020',
    platforms: [],
  });
});

test('longest token wins: "xbox series x" leaves no stray "x" and no bare-xbox match', () => {
  assert.deepEqual(parseQuery('elden ring xbox series x'), {
    title: 'elden ring',
    platforms: ['xbox-series'],
  });
});

test('bare "xbox" maps to both xbox generations', () => {
  assert.deepEqual(parseQuery('halo xbox'), {
    title: 'halo',
    platforms: ['xbox-series', 'xbox-one'],
  });
});

test('Hebrew multi-word token "פלייסטיישן 5" maps to ps5', () => {
  assert.deepEqual(parseQuery('פיפא פלייסטיישן 5'), {
    title: 'פיפא',
    platforms: ['ps5'],
  });
});

test('bare Hebrew "פלייסטיישן" maps to both ps5 and ps4', () => {
  assert.deepEqual(parseQuery('gta פלייסטיישן'), {
    title: 'gta',
    platforms: ['ps5', 'ps4'],
  });
});

test('word boundaries: "pspice" must not match the "ps" token', () => {
  assert.deepEqual(parseQuery('pspice simulator'), {
    title: 'pspice simulator',
    platforms: [],
  });
});

test('"nintendo switch" is consumed as one token', () => {
  assert.deepEqual(parseQuery('zelda nintendo switch'), {
    title: 'zelda',
    platforms: ['switch'],
  });
});

test('case-insensitive match, deduplication, and whitespace normalization', () => {
  assert.deepEqual(parseQuery('  doom   PC  steam '), {
    title: 'doom',
    platforms: ['pc'],
  });
});

test('empty input yields empty title and no platforms', () => {
  assert.deepEqual(parseQuery(''), {
    title: '',
    platforms: [],
  });
});
