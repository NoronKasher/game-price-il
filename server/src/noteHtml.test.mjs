import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeNote, MAX_NOTE_BYTES } from './noteHtml.ts';

/**
 * The note sanitiser.
 *
 * This is the one place in the tool where user-authored HTML is stored and
 * later rendered, so it is the one place a stored XSS could live — and notes
 * travel in the portable token, which people paste to each other. A note from
 * somebody else's machine is exactly as untrusted as a web page.
 *
 * The cases below are deliberately adversarial. Anything that survives here
 * runs inside the app with the user's data in front of it.
 */

/* ── What a note is FOR ──────────────────────────────────────────────────── */

test('the formatting people actually want survives', () => {
  const note = sanitizeNote('<b>wait for the GOTY</b> — <i>gift for Dana</i> 🎁');
  assert.match(note, /<b>wait for the GOTY<\/b>/);
  assert.match(note, /<i>gift for Dana<\/i>/);
  assert.match(note, /🎁/, 'emoji are just text and must pass through untouched');
});

test('colours and fonts survive', () => {
  const note = sanitizeNote('<span style="color: #ff0000; font-family: Arial; font-size: 18px">hi</span>');
  assert.match(note, /color:\s*#ff0000/);
  assert.match(note, /font-family:\s*Arial/);
  assert.match(note, /font-size:\s*18px/);
});

test('a pasted image survives', () => {
  // Dragging a picture into a contenteditable produces exactly this.
  const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const note = sanitizeNote(`<img src="${data}" alt="box art">`);
  assert.match(note, /src="data:image\/png;base64,/);
  assert.match(note, /alt="box art"/);
});

/* ── What must never survive ─────────────────────────────────────────────── */

test('script tags go, contents and all', () => {
  const note = sanitizeNote('before<script>alert(1)</script>after');
  assert.ok(!/script/i.test(note), note);
  assert.ok(!/alert/.test(note), 'the CODE has to go with the tag, not just the tag');
  assert.match(note, /before/);
  assert.match(note, /after/);
});

test('every event handler is stripped', () => {
  for (const attack of [
    '<img src=x onerror="alert(1)">',
    '<div onclick="alert(1)">click</div>',
    '<b ONMOUSEOVER="alert(1)">hover</b>',
    '<p onload=alert(1)>hi</p>',
  ]) {
    const note = sanitizeNote(attack);
    assert.ok(!/on\w+\s*=/i.test(note), `survived: ${attack} → ${note}`);
    assert.ok(!/alert/.test(note), `survived: ${attack} → ${note}`);
  }
});

test('javascript: links are dropped, the text is kept', () => {
  const note = sanitizeNote('<a href="javascript:alert(1)">click me</a>');
  assert.ok(!/javascript:/i.test(note), note);
  assert.match(note, /click me/, 'the words are not the attack');
});

test('a real link keeps its address and gains noopener', () => {
  const note = sanitizeNote('<a href="https://example.com/x">shop</a>');
  assert.match(note, /href="https:\/\/example\.com\/x"/);
  assert.match(note, /rel="noopener noreferrer"/, 'window.opener is a way back into this app');
  assert.match(note, /target="_blank"/);
});

test('an SVG image is refused even though it is an image', () => {
  // An SVG is a document, and a document can carry script.
  const note = sanitizeNote('<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==">');
  assert.ok(!/svg/i.test(note), note);
});

test('CSS that fetches or executes is dropped, the rest of the style survives', () => {
  const note = sanitizeNote(
    '<span style="color: red; background-image: url(https://evil.test/pixel.gif)">x</span>'
  );
  assert.match(note, /color:\s*red/, 'the safe property stays');
  assert.ok(!/url\(/i.test(note), note);
  assert.ok(!/background-image/i.test(note), 'and a property that takes a URL is not on the list at all');
});

test('CSS expression() and escapes are refused', () => {
  for (const style of [
    'width: expression(alert(1))',
    'color: \\6a avascript:alert(1)',
    'color: red; behavior: url(#x)',
  ]) {
    const note = sanitizeNote(`<span style="${style}">x</span>`);
    assert.ok(!/expression|behavior|\\\\/i.test(note), `survived: ${style} → ${note}`);
  }
});

test('positioning is not allowed — a note must not cover the app', () => {
  const note = sanitizeNote('<div style="position: fixed; top: 0; z-index: 99999; color: red">x</div>');
  assert.ok(!/position|z-index/i.test(note), note);
  assert.match(note, /color:\s*red/);
});

test('iframes, objects and forms are removed entirely', () => {
  for (const attack of [
    '<iframe src="https://evil.test"></iframe>',
    '<object data="x.swf"></object>',
    '<embed src="x">',
    '<form action="https://evil.test"><input name="x"></form>',
  ]) {
    const note = sanitizeNote(attack);
    assert.ok(!/iframe|object|embed|<form|<input/i.test(note), `survived: ${attack} → ${note}`);
  }
});

test('a malformed tag cannot smuggle another one through', () => {
  // The classic against a regex-based stripper: removing the inner <script>
  // leaves the outer one intact. A real parser never sees it that way.
  const note = sanitizeNote('<scr<script>ipt>alert(1)</scr</script>ipt>');
  assert.ok(!/<script/i.test(note), note);
  // What is left is escaped TEXT. Text that happens to read "alert(1)" is not
  // an attack — the tag that would have run it is gone, and any stray angle
  // bracket comes back as &gt; rather than opening an element.
  assert.ok(!/<[a-z]/i.test(note), `no element may survive this: ${note}`);
});

test('an unknown tag is unwrapped so its words survive', () => {
  const note = sanitizeNote('<marquee>still readable</marquee>');
  assert.ok(!/marquee/i.test(note));
  assert.match(note, /still readable/);
});

test('an image sized to swallow the screen is clamped', () => {
  const note = sanitizeNote('<img src="https://example.com/a.png" width="100000" height="99999">');
  assert.ok(!/100000|99999/.test(note), note);
});

/* ── Bounds and emptiness ────────────────────────────────────────────────── */

test('an oversized note is truncated rather than stored whole', () => {
  const huge = '<b>' + 'a'.repeat(MAX_NOTE_BYTES * 2) + '</b>';
  assert.ok(sanitizeNote(huge).length <= MAX_NOTE_BYTES + 64);
});

test('empty has exactly one representation', () => {
  assert.equal(sanitizeNote(''), '');
  assert.equal(sanitizeNote('   '), '');
  assert.equal(sanitizeNote('<p></p><div>  </div>'), '', 'a note of empty tags is an empty note');
  assert.equal(sanitizeNote(null), '');
  assert.equal(sanitizeNote(undefined), '');
  assert.equal(sanitizeNote(42), '');
});

test('a note that is only an image is not empty', () => {
  const note = sanitizeNote('<img src="https://example.com/a.png">');
  assert.notEqual(note, '', 'there is no text, but there is very much a note');
});
