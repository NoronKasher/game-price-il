import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeToken, decodeToken, looksLikeToken } from './portableToken.ts';

/**
 * The tracked list as one pasteable string.
 *
 * What has to hold: it survives the trip (chat clients wrap long strings and
 * people copy them badly), a paste that is not one of ours is ordinary input
 * rather than an error, and a hostile string cannot make the decoder do
 * something expensive. The decoded items still go through the same sanitiser a
 * file import does — a token is untrusted input exactly like one.
 */

const items = [
  {
    title: 'Hollow Knight',
    platform: 'pc',
    refs: [{ sourceId: 'steam-regional', sourceGameId: '367520' }],
    history: [{ store: 'Steam', price_ils: 89.12, checked_at: '2026-08-01 10:00:00' }],
  },
  { title: 'Celeste', platform: 'switch', refs: [], history: [] },
];

/** The export shape, which is what the compact form has to reconstruct. */
const exported = [
  {
    title: 'Hollow Knight',
    platform: 'pc',
    image: 'https://example.test/hk.jpg',
    refs: [{ sourceId: 'steam-regional', sourceGameId: '367520' }],
    preferred_region: 'IL',
    hide_desc: 0,
    // The export shape carries the user's note now, so the round trip has to
    // reconstruct it too — including its formatting.
    note: '<b>wait for the GOTY</b>',
    added_at: '2026-07-01 08:00:00',
    history: [
      { store: 'Steam', region: 'IL', kind: 'digital', price: 89.12, currency: 'ILS', price_ils: 89.12, checked_at: '2026-08-01 10:00:00' },
      { store: 'Steam', region: 'TR', kind: 'digital', price: 199, currency: 'TRY', price_ils: 21.4, checked_at: '2026-08-08 10:00:00' },
    ],
  },
  {
    title: 'Celeste',
    platform: 'switch',
    image: null,
    refs: [],
    preferred_region: null,
    hide_desc: 0,
    note: null,
    added_at: '2026-07-02 08:00:00',
    history: [],
  },
];

test('a list survives the round trip exactly', async () => {
  const token = await encodeToken(exported);
  const back = await decodeToken(token);
  assert.deepEqual(back.items, exported, 'the compact form must reconstruct the export shape byte for byte');
});

test('a note travels with the game and keeps its formatting', async () => {
  const back = await decodeToken(await encodeToken(exported));
  assert.equal(back.items[0].note, '<b>wait for the GOTY</b>');
  assert.equal(back.items[1].note, null, 'and a game with no note still has none');
});

test('prices and timestamps come back with no drift', async () => {
  // Prices travel as integer agorot and timestamps as seconds since the
  // previous point in the same game. Both are lossless for the values the
  // database actually holds, and a test is the only thing keeping them so.
  const back = await decodeToken(await encodeToken(exported));
  const [first, second] = back.items[0].history;
  assert.equal(first.price, 89.12);
  assert.equal(second.price, 199);
  assert.equal(second.price_ils, 21.4);
  assert.equal(first.checked_at, '2026-08-01 10:00:00');
  assert.equal(second.checked_at, '2026-08-08 10:00:00', 'the delta must rebuild the real time');
});

test('the compact form is much shorter than the plain one', async () => {
  // Measured on the real database, 9,876 characters became 6,024. Length is
  // what decides whether somebody actually pastes this into a chat message.
  const many = Array.from({ length: 30 }, (_, i) => ({
    ...exported[0],
    title: `Game ${i}`,
    history: Array.from({ length: 30 }, (_, k) => ({
      store: 'Xbox 🇹🇷',
      region: 'TR',
      kind: 'digital',
      price: 199 + k,
      currency: 'TRY',
      price_ils: 21.4 + k,
      checked_at: `2026-08-${String((k % 28) + 1).padStart(2, '0')} 10:00:00`,
    })),
  }));
  const compact = (await encodeToken(many)).length;
  const plain = JSON.stringify({ v: 1, items: many }).length;
  assert.ok(compact < plain / 8, `expected well under an eighth of ${plain}, got ${compact}`);
});

test('a v1 token still decodes', async () => {
  // Somebody saved one before the compact format existed. It costs a dozen
  // lines to keep reading them and a silent failure not to.
  const legacy = { v: 1, at: '2026-08-01T00:00:00Z', items: exported, prefs: { gp_open_anim: '0' } };
  const bytes = new Uint8Array(
    await new Response(
      new Blob([JSON.stringify(legacy)]).stream().pipeThrough(new CompressionStream('gzip'))
    ).arrayBuffer()
  );
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const token = 'VGPT1-' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const back = await decodeToken(token);
  assert.deepEqual(back.items, exported);
  assert.deepEqual(back.prefs, { gp_open_anim: '0' });
});

test('remembered preferences travel with the list', async () => {
  // The whole point of carrying them: arriving on a new machine to popups you
  // dismissed for good a month ago is the opposite of "your data moved".
  const prefs = { gp_hide_region_notice: '1', gp_quiet_notices: '1' };
  const back = await decodeToken(await encodeToken(exported, prefs));
  assert.deepEqual(back.prefs, prefs);
});

test('a token with no preferences yields an empty object, not undefined', async () => {
  const back = await decodeToken(await encodeToken(exported));
  assert.deepEqual(back.prefs, {});
});

test('the token is compact enough to paste', async () => {
  // Size is the design constraint, not a style point: measured against a real
  // database the list costs ~220 characters per game and its history ~1,980,
  // which is the whole reason history is optional in the UI.
  //
  // Checked on a realistic list rather than a two-item one. Gzip's header plus
  // base64's 4/3 expansion means a few hundred bytes come out LONGER, which is
  // true, harmless, and not what this is protecting.
  const many = Array.from({ length: 40 }, (_, i) => ({
    title: `Some Game With A Reasonably Long Name ${i}`,
    platform: 'pc',
    refs: [{ sourceId: 'steam-regional', sourceGameId: String(100000 + i) }],
    history: Array.from({ length: 12 }, () => ({
      store: 'Steam',
      region: 'IL',
      kind: 'digital',
      price_ils: 89.12,
      checked_at: '2026-08-01 10:00:00',
    })),
  }));
  const token = await encodeToken(many);
  const plain = JSON.stringify(many).length;
  assert.ok(token.length < plain / 4, `expected well under a quarter of ${plain}, got ${token.length}`);
  assert.ok(token.startsWith('VGPT1-'));
});

test('a token that got wrapped in transit still decodes', async () => {
  // Chat clients and mail both break long strings across lines, and the paste
  // comes back with newlines through the middle of it.
  const token = await encodeToken(exported);
  const wrapped = token.replace(/(.{40})/g, '$1\n');
  assert.deepEqual((await decodeToken(wrapped)).items, exported);
});

test('surrounding whitespace is forgiven', async () => {
  const token = await encodeToken(exported);
  assert.deepEqual((await decodeToken(`   ${token}  `)).items, exported);
});

test('something that is not our token is null, not an exception', async () => {
  // All of these are things a person will genuinely paste.
  for (const junk of ['', '   ', 'hello', 'https://example.com', '{"items":[]}', 'VGPT1-']) {
    assert.equal(await decodeToken(junk), null, JSON.stringify(junk));
  }
});

test('a truncated token is refused rather than half-read', async () => {
  const token = await encodeToken(items);
  assert.equal(await decodeToken(token.slice(0, token.length - 20)), null);
});

test('a token whose payload is not ours decodes to nothing', async () => {
  // Correct gzip, correct base64, wrong contents. It must not become an item.
  const bytes = new Uint8Array(
    await new Response(
      new Blob([JSON.stringify({ v: 1, at: 'now', items: 'not an array' })])
        .stream()
        .pipeThrough(new CompressionStream('gzip'))
    ).arrayBuffer()
  );
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const forged = 'VGPT1-' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(await decodeToken(forged), null);
});

test('an empty list is still a valid token', async () => {
  assert.deepEqual((await decodeToken(await encodeToken([]))).items, []);
});

test('a large list encodes without blowing the stack', async () => {
  // fromCharCode(...arr) throws on a big enough array, and "big enough" here is
  // an ordinary tracked list with a year of history.
  const many = Array.from({ length: 400 }, (_, i) => ({
    title: `Game ${i}`,
    platform: 'pc',
    refs: [{ sourceId: 'steam-regional', sourceGameId: String(i) }],
    history: Array.from({ length: 20 }, (_, k) => ({
      store: 'Steam',
      price_ils: 10 + k,
      checked_at: '2026-08-01 10:00:00',
    })),
  }));
  const token = await encodeToken(many);
  const back = await decodeToken(token);
  assert.equal(back.items.length, 400);
  assert.equal(back.items[399].history.length, 20);
});

test('looksLikeToken tells a paste apart from a file', () => {
  assert.equal(looksLikeToken('VGPT1-abc'), true);
  assert.equal(looksLikeToken('  VGPT1-abc'), true);
  assert.equal(looksLikeToken('{"items":[]}'), false);
});

/* ── Settings, the other half that did not travel ────────────────────────── */

test('database-side settings travel with the list', async () => {
  // The token restored your games and your dismissed notices, then quietly put
  // your display currency and alert rule back to default. Nothing errored — the
  // settings simply were not in the string.
  const settings = { display_currency: 'TRY', secondary_currency: 'ILS', capture_days_global: '3' };
  const back = await decodeToken(await encodeToken(exported, {}, settings));
  assert.deepEqual(back.settings, settings);
});

test('a token with no settings yields an empty object, not undefined', async () => {
  assert.deepEqual((await decodeToken(await encodeToken(exported))).settings, {});
});

test('a v1 token decodes with empty settings rather than throwing', async () => {
  const legacy = { v: 1, at: '2026-08-01T00:00:00Z', items: exported };
  const bytes = new Uint8Array(
    await new Response(
      new Blob([JSON.stringify(legacy)]).stream().pipeThrough(new CompressionStream('gzip'))
    ).arrayBuffer()
  );
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const token = 'VGPT1-' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const back = await decodeToken(token);
  assert.deepEqual(back.settings, {});
  assert.deepEqual(back.items, exported);
});
