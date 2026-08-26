import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasHebrew, toLatinQuery } from './hebrewTitles.ts';

/**
 * Hebrew queries, translated before the stores are asked.
 *
 * The rule these cases exist to protect is the one in the module header: a
 * query is translated or it is dropped, never transliterated. A letter-by-letter
 * rendering of an unvowelled Hebrew word matches nothing in any catalogue, so
 * shipping one would mean shipping a search that is always empty while looking
 * like it works.
 */

test('a Latin query is left completely alone', () => {
  // Not "unchanged" — untouched. The caller must be able to tell the difference
  // between "nothing to translate" and "translated to the same thing".
  assert.equal(toLatinQuery('Cyberpunk 2077'), null);
  assert.equal(toLatinQuery(''), null);
  assert.equal(toLatinQuery('   '), null);
});

test('a known franchise becomes what the stores call it', () => {
  assert.equal(toLatinQuery('סייברפאנק').query, 'Cyberpunk 2077');
  assert.equal(toLatinQuery('זלדה').query, 'Zelda');
  assert.equal(toLatinQuery('ספיידרמן').query, 'Spider-Man');
});

test('numbers and Latin words in a mixed query survive', () => {
  // "ספיידרמן 2" must keep its 2 — dropping it would search the whole series
  // when the user had already told us which one.
  assert.equal(toLatinQuery('ספיידרמן 2').query, 'Spider-Man 2');
});

test('a multi-word name beats any single word inside it', () => {
  assert.equal(toLatinQuery('גוד אוף וור').query, 'God of War');
  // "אוף" alone means "of"; it must not win against the phrase.
  assert.equal(toLatinQuery('מלחמת הכוכבים').query, 'Star Wars');
});

test('an unknown word is dropped, never transliterated', () => {
  // The whole point. "Zelda" finds the series; "Zelda tyrs" finds nothing.
  const r = toLatinQuery('זלדה משהו');
  assert.equal(r.query, 'Zelda');
  assert.deepEqual(r.dropped, ['משהו']);
  assert.deepEqual(r.matched, ['זלדה']);
});

test('a query we cannot translate at all comes back empty rather than mangled', () => {
  const r = toLatinQuery('משחק כלשהו');
  assert.equal(r.query, '');
  assert.equal(r.dropped.length, 2);
});

test('the geresh can be typed any of the ways a keyboard produces it', () => {
  // U+05F3, a straight apostrophe and a curly one all reach the same row.
  for (const mark of ['׳', "'", '’']) {
    assert.equal(toLatinQuery(`אנצ${mark}רטד`).query, 'Uncharted', `failed for ${mark}`);
  }
});

test('edition words inside a title are translated too', () => {
  assert.equal(toLatinQuery('סייברפאנק אולטימט אדישן').query, 'Cyberpunk 2077 Ultimate Edition');
});

test('hasHebrew is about letters, not direction', () => {
  assert.equal(hasHebrew('שלום'), true);
  assert.equal(hasHebrew('hello'), false);
  assert.equal(hasHebrew('FIFA 24'), false);
  assert.equal(hasHebrew('FIFA פיפא'), true);
});

test('what was matched and what was dropped are both reported', () => {
  // The UI shows these. A rewrite the user cannot see is one they cannot
  // correct.
  const r = toLatinQuery('הארי פוטר קווידיץ׳');
  assert.equal(r.query, 'Harry Potter');
  assert.deepEqual(r.matched, ['הארי פוטר']);
  assert.deepEqual(r.dropped, ['קווידיץ׳']);
});
