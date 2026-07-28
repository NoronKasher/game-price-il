import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProduct, titleMatchesQuery } from './normalize.ts';

test('editions of one game collapse to the same groupKey', () => {
  const base = describeProduct('Red Dead Redemption 2');
  const ult = describeProduct('Red Dead Redemption 2: Ultimate Edition');
  assert.equal(base.groupKey, ult.groupKey);
  assert.equal(base.edition, null);
  assert.equal(ult.edition, 'Ultimate');
});

test('"Standard Edition" is the base game (null edition) so discs merge with plain listings', () => {
  const std = describeProduct('EA Sports FC 25 Standard Edition PS4');
  const plain = describeProduct('EA SPORTS FC 25 PS4');
  assert.equal(std.groupKey, plain.groupKey);
  assert.equal(std.edition, null); // Standard is shown as רגילה, not a separate edition
  // a real edition still stays distinct
  assert.equal(describeProduct('God of War Ragnarok Deluxe Edition PS5').edition, 'Deluxe');
});

test('a sequel number is never treated as an edition', () => {
  const one = describeProduct('Red Dead Redemption');
  const two = describeProduct('Red Dead Redemption 2');
  assert.notEqual(one.groupKey, two.groupKey);
});

test("Collector's Edition with a curly apostrophe still strips", () => {
  const d = describeProduct('ELDEN RING SHADOW OF THE ERDTREE COLLECTOR’S EDITION PS5');
  assert.equal(d.groupKey, 'elden ring shadow of the erdtree');
  assert.equal(d.edition, "Collector's");
  assert.deepEqual(d.platforms, ['ps5']);
});

test('a platform-only parenthetical is stripped for grouping', () => {
  const tagged = describeProduct('Red Dead Redemption (PC)');
  const plain = describeProduct('Red Dead Redemption');
  assert.equal(tagged.groupKey, plain.groupKey);
});

test('localized PSN prices parse across regional number formats', async () => {
  const { parseLocalizedPrice } = await import('./adapters/psn.ts');
  assert.equal(parseLocalizedPrice('1.399,50 TL'), 1399.5); // Turkey: . thousands, , decimal
  assert.equal(parseLocalizedPrice('₹2,499'), 2499); // India: , thousands, no decimals
  assert.equal(parseLocalizedPrice('R 1,559.00'), 1559); // South Africa: , thousands . decimal
  assert.equal(parseLocalizedPrice('£59.99'), 59.99); // UK
  assert.equal(parseLocalizedPrice('US$ 29.39'), 29.39);
  assert.equal(parseLocalizedPrice('Included'), null); // no digits
});

test('store search: real title matches survive the relevance guard', () => {
  assert.equal(titleMatchesQuery('fallout', 'Fallout 4 PS5'), true);
  assert.equal(titleMatchesQuery('fallout', 'Fallout'), true);
  assert.equal(titleMatchesQuery('God of War', 'God of War Ragnarök PS5'), true);
  assert.equal(titleMatchesQuery('Zelda Tears of the Kingdom', 'The Legend of Zelda: Tears of the Kingdom'), true);
  assert.equal(titleMatchesQuery('fallout', 'Fallout4'), true); // no-space concatenation
});

test('store search: unrelated catalog noise is dropped (the "fallout" bug)', () => {
  // Exactly the junk the shop search returned above the real "Fallout" results.
  assert.equal(titleMatchesQuery('fallout', 'ניקוי וחיזוק יסודי של מכשיר PS4'), false);
  assert.equal(titleMatchesQuery('fallout', 'החלפת ספק כוח Xbox Series'), false);
  assert.equal(titleMatchesQuery('fallout', 'Super Smash Bros Switch'), false);
  assert.equal(titleMatchesQuery('fallout', 'תיקון HDMI PRO PS4'), false);
});

test('store search: shared filler/platform words alone do not count as a match', () => {
  assert.equal(titleMatchesQuery('God of War', 'The Last of Us Part II PS5'), false); // only "of" overlaps
  assert.equal(titleMatchesQuery('Fallout PS5', 'Gran Turismo 7 PS5'), false); // only "ps5" overlaps
});

test('trailing disc-language tokens are stripped so IL discs group with the base game', () => {
  // Bug lists physical discs with a language suffix — it must still group with the base game.
  assert.equal(describeProduct('EA SPORTS FC 25 ENGLISH ARABIC PS5').groupKey, 'ea sports fc 25');
  assert.equal(describeProduct('Mortal Kombat 1 Hebrew English PS5').groupKey, 'mortal kombat 1');
  // must NOT over-strip a normal title that merely ends in a non-language word
  assert.equal(describeProduct('God of War Ragnarok PS5').groupKey, 'god of war ragnarok');
  assert.equal(describeProduct('EA Sports FC 25 PS5').groupKey, 'ea sports fc 25');
});

test('accessories are flagged, real games are not', () => {
  assert.equal(describeProduct('+ FORZA HORIZON 5 + 458 SPIDER חבילת נהיגה').accessory, true);
  assert.equal(
    describeProduct('THRUSTMASTER ESWAP X2 ELDEN RING EDITION XBOX SERIES X').accessory,
    true
  );
  assert.equal(describeProduct('PowerA Zelda Switch Carrying Case').accessory, true);
  assert.equal(describeProduct('Elden Ring PS4').accessory, false);
  assert.equal(describeProduct('God of War Ragnarok').accessory, false);
});
