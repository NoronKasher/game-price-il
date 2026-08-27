import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProduct, looksLikeAccessory, titleMatchesQuery } from './normalize.ts';

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
  const { parseLocalizedPrice } = await import('./normalize.ts');
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

/* ── Hebrew accessory words ──────────────────────────────────────────────── */

test('Hebrew accessory words are actually caught', async () => {
  // They were not. Two of these had been eaten into literal backspace
  // characters, and the rest used `\b` — which JavaScript defines as a boundary
  // between [A-Za-z0-9_] and anything else. A Hebrew letter IS "anything else",
  // so beside Hebrew the assertion can never hold and the alternative is dead.
  //
  // Measured before the fix: "בקר אלחוטי" — a wireless CONTROLLER — went
  // straight through the accessory filter and into game results.
  for (const accessory of ['שלט', 'בקר', 'בקר אלחוטי', 'שלט אלחוטי לפלייסטיישן', 'אוזניות גיימינג']) {
    assert.equal(looksLikeAccessory(accessory), true, `should be filtered: ${accessory}`);
  }
});

test('a word that merely starts the same is not an accessory', () => {
  // What the boundaries are FOR. "בקרוב" (soon) and "שלטון" (regime) both begin
  // with an accessory word and are neither.
  for (const notAccessory of ['בקרוב', 'שלטון האופל', 'The Last of Us', 'Elden Ring']) {
    assert.equal(looksLikeAccessory(notAccessory), false, `should NOT be filtered: ${notAccessory}`);
  }
});

test('no source file carries a stray control character', async () => {
  // Two did, and both were invisible in review. web/src/api.demo.ts held a
  // literal NUL, which made grep, ripgrep and git diff treat the whole file as
  // binary and silently skip it. normalize.ts held two backspaces where `\b`
  // had been meant, which is how the Hebrew accessory filter came to be dead.
  //
  // Cheap to check, and the class of bug is one nobody spots by reading.
  const { readFile } = await import('node:fs/promises');
  const { glob } = await import('node:fs/promises');
  const roots = ['server/src', 'web/src', 'extension/src'];
  const offenders = [];
  for (const root of roots) {
    for await (const file of glob(`${root}/**/*.{ts,tsx,mjs}`)) {
      const bytes = await readFile(file);
      for (const [i, byte] of bytes.entries()) {
        // Everything below 0x09, and 0x0E–0x1F. Tab, LF and CR are fine.
        if (byte < 9 || (byte > 13 && byte < 32)) {
          offenders.push(`${file} @${i} (0x${byte.toString(16)})`);
          break;
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `stray control characters:\n  ${offenders.join('\n  ')}`);
});

/* ── Duplicates found with the diagnostic export ─────────────────────────── */

test('an abbreviation and its full name are the same game', async () => {
  // "GTA V" from an Israeli shop and "Grand Theft Auto V" from Steam sat on
  // the board as two entries. Found by exporting a real search and reading the
  // group keys it produced.
  const { groupKey } = await import('./normalize.ts');
  for (const [short, long] of [
    ['GTA V', 'Grand Theft Auto V'],
    ['GTA VI', 'Grand Theft Auto VI'],
    ['COD Modern Warfare', 'Call of Duty Modern Warfare'],
    ['NFS Unbound', 'Need for Speed Unbound'],
  ]) {
    assert.equal(groupKey(short), groupKey(long), `${short} vs ${long}`);
  }
});

test('stripping a SKU never costs the platform chip', async () => {
  // The first attempt at the fix above stripped bare platform tokens too, and
  // broke something it was not aimed at: stripPlatformTokens READS those to
  // decide which platform a listing is for, so every such card lost its chip.
  // A duplicate fix that silently removes platform detection is not a fix.
  const { describeProduct } = await import('./normalize.ts');
  assert.deepEqual(describeProduct('ELDEN RING COLLECTOR’S EDITION PS5').platforms, ['ps5']);
  assert.deepEqual(describeProduct('Halo Infinite Xbox').platforms, ['xbox']);
  assert.deepEqual(describeProduct('Grand Theft Auto V (PS4™ & PS5™)').platforms, ['ps5']);
});

test('a console SKU suffix does not make a second game', async () => {
  // All four of these were live duplicates beside the plain title.
  const { groupKey } = await import('./normalize.ts');
  const plain = groupKey('Grand Theft Auto V');
  for (const tagged of [
    'Grand Theft Auto V (Xbox One & S)',
    'Grand Theft Auto V (Xbox Series X S)',
    'Grand Theft Auto V (PS4™ & PS5™)',
    'Grand Theft Auto V - Nintendo Switch 2',
  ]) {
    assert.equal(groupKey(tagged), plain, tagged);
  }
});

test('a Hebrew note about the BOX does not make a second game', async () => {
  // "ללא אריזה" is "without packaging" — a second-hand condition note an
  // Israeli shop puts in the product title. Not a different game.
  const { groupKey } = await import('./normalize.ts');
  const plain = groupKey('The Witcher 3: Wild Hunt');
  for (const noisy of [
    'The Witcher 3: Wild Hunt ללא אריזה!',
    'The Witcher 3: Wild Hunt יד שנייה',
    'The Witcher 3: Wild Hunt - משומש',
  ]) {
    assert.equal(groupKey(noisy), plain, noisy);
  }
});

test('games that merely look alike are still kept apart', async () => {
  // The failure that matters more than a duplicate: merging two DIFFERENT
  // games. A duplicate is untidy; a wrong merge shows the wrong price.
  const { groupKey } = await import('./normalize.ts');
  for (const [a, b] of [
    ['Grand Theft Auto V', 'Grand Theft Auto VI'],
    ['Elden Ring', 'Elden Ring Nightreign'],
    ['Portal', 'Portal 2'],
    ['Hades', 'Hades II'],
    ['Call of Duty Modern Warfare', 'Call of Duty Black Ops'],
  ]) {
    assert.notEqual(groupKey(a), groupKey(b), `${a} must not merge with ${b}`);
  }
});

test('a bare trailing "ONE" is deliberately NOT stripped', async () => {
  // "ELDEN RING NIGHTREIGN ONE" really does mean Xbox One, and stripping a
  // trailing bare "ONE" would fix it — but "Rogue One" and anything else
  // legitimately ending in the word would then merge into its base game. A
  // duplicate is untidy; a wrong merge shows somebody the wrong price. This
  // pins the trade-off so it is a decision rather than an oversight.
  const { groupKey } = await import('./normalize.ts');
  assert.notEqual(groupKey('ELDEN RING NIGHTREIGN ONE'), groupKey('Elden Ring Nightreign'));
});

test('expanding an abbreviation never doubles a name that is already there', async () => {
  // The first version of the abbreviation fix CREATED duplicates. Shops write
  // "Grand Theft Auto V GTA" and "GTA: Grand Theft Auto: The Trilogy", and
  // expanding every occurrence turned those into "...V grand theft auto" — a
  // brand-new key, produced by the fix for duplicate keys.
  const { groupKey } = await import('./normalize.ts');
  assert.equal(groupKey('Grand Theft Auto V GTA'), groupKey('Grand Theft Auto V'));
  assert.equal(groupKey('GTA: Grand Theft Auto: The Trilogy'), groupKey('Grand Theft Auto: The Trilogy'));
});
