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

test('a list survives the round trip exactly', async () => {
  const token = await encodeToken(items);
  assert.deepEqual(await decodeToken(token), items);
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
  const token = await encodeToken(items);
  const wrapped = token.replace(/(.{40})/g, '$1\n');
  assert.deepEqual(await decodeToken(wrapped), items);
});

test('surrounding whitespace is forgiven', async () => {
  const token = await encodeToken(items);
  assert.deepEqual(await decodeToken(`   ${token}  `), items);
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
  assert.deepEqual(await decodeToken(await encodeToken([])), []);
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
  assert.equal(back.length, 400);
  assert.equal(back[399].history.length, 20);
});

test('looksLikeToken tells a paste apart from a file', () => {
  assert.equal(looksLikeToken('VGPT1-abc'), true);
  assert.equal(looksLikeToken('  VGPT1-abc'), true);
  assert.equal(looksLikeToken('{"items":[]}'), false);
});
