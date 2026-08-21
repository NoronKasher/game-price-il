import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTiles, pickGameTile } from './adapters/ubisoft.ts';

/**
 * Fixtures are trimmed from real store.ubisoft.com search grids. Ubisoft titles
 * every SKU of a game identically and puts the real identity in the subtitle, so
 * these tests guard the one rule that keeps a DLC's price off the board.
 */
const tile = (title, subtitle, sales, standard) => `
  <div class="card-details__title-wrapper">
    <div class="card-title "><div class="prod-title"> ${title} </div></div>
    ${subtitle == null ? '' : `<div class="card-subtitle"> ${subtitle} </div>`}
  </div>
  <div class="card-price">
    <span class="product-price price">
      <span class="price-wrapper">
        <span class="price-sales standard-price"> ${sales} </span>
        ${standard == null ? '' : `<span class="price-standard"><span class="price-item">${standard}</span></span>`}
      </span>
    </span>
  </div>`;

const US_FAR_CRY_5 = [
  tile('Far Cry 5', 'Gold Edition', '$13.50', '$89.99'),
  tile('Far Cry 5', 'Standard Edition', '$9.00', '$59.99'),
  tile('Far Cry 5', '2400 Credits', '$19.99'),
  tile('Far Cry 5', 'Season Pass', '$4.50'),
  tile('Far Cry 5', 'Expansion III: Dead Living Zombies', '$1.20'),
  tile('Far Cry 5', 'Deluxe Pack', '$9.99'),
].join('');

test('parses one tile per product, keeping title and subtitle apart', () => {
  const tiles = parseTiles(US_FAR_CRY_5);
  assert.equal(tiles.length, 6);
  assert.equal(tiles[0].title, 'Far Cry 5');
  assert.equal(tiles[0].subtitle, 'Gold Edition');
  assert.equal(tiles[0].sales, '$13.50');
  assert.equal(tiles[0].standard, '$89.99');
});

test('picks the standard edition, never a cheaper DLC of the same title', () => {
  const pick = pickGameTile(parseTiles(US_FAR_CRY_5), 'far cry 5');
  assert.equal(pick.value, 9); // NOT 1.20 (an expansion) and NOT 4.50 (season pass)
  assert.equal(pick.tile.subtitle, 'Standard Edition');
});

test('falls back to the cheapest real edition when no standard one is listed', () => {
  const html = [
    tile('Far Cry 5', 'Gold Edition', '$13.50'),
    tile('Far Cry 5', 'Ultimate Edition', '$29.99'),
    tile('Far Cry 5', '500 Credits', '$4.99'),
  ].join('');
  const pick = pickGameTile(parseTiles(html), 'far cry 5');
  assert.equal(pick.value, 13.5);
});

test('a game with no edition line is still priced', () => {
  const pick = pickGameTile(parseTiles(tile('Far Cry 3', null, '$19.99')), 'far cry 3');
  assert.equal(pick.value, 19.99);
});

test('"Game of the Year Upgrade Pass" is an upgrade, not the game', () => {
  const html = [
    tile('Far Cry 6', 'Game of the Year Upgrade Pass', 'TL374.75'),
    tile('Far Cry 6', 'Standard Edition', 'TL499.75'),
  ].join('');
  const pick = pickGameTile(parseTiles(html), 'far cry 6');
  assert.equal(pick.value, 499.75);
});

test('a store that lists only add-ons yields no price at all', () => {
  // Korea labels editions in Korean, so nothing here is recognisable as the
  // game — a missing row is correct; pricing a currency pack would not be.
  const html = [
    tile('Far Cry 6', '광기', '₩ 4,125'),
    tile('Far Cry 6', '기본 팩 500', '₩ 6,000'),
  ].join('');
  assert.equal(pickGameTile(parseTiles(html), 'far cry 6'), null);
});

test('a different game sharing a word is never matched', () => {
  const pick = pickGameTile(parseTiles(US_FAR_CRY_5), 'far cry 6');
  assert.equal(pick, null);
});

test('localized separators and entity-encoded symbols parse to real amounts', () => {
  const jp = pickGameTile(parseTiles(tile('Far Cry 5', 'Standard Edition', '&yen; 2,640')), 'far cry 5');
  assert.equal(jp.value, 2640); // not 2.640
  const de = pickGameTile(parseTiles(tile('Far Cry 5', 'Standard Edition', '59,99 &euro;')), 'far cry 5');
  assert.equal(de.value, 59.99);
  const tr = pickGameTile(parseTiles(tile('Far Cry 5', 'Standard Edition', 'TL1.399,50')), 'far cry 5');
  assert.equal(tr.value, 1399.5);
});

test('a numeric HTML entity in the price cannot inflate it', () => {
  // "&#36;59.99" left encoded would keep the "36" and parse as 3659.99.
  const pick = pickGameTile(parseTiles(tile('Far Cry 5', 'Standard Edition', '&#36;59.99')), 'far cry 5');
  assert.equal(pick.value, 59.99);
});

test("an entity-encoded apostrophe does not fork the title's group key", () => {
  // "Assassin&rsquo;s Creed" must land on the same key as "Assassin's Creed",
  // or the same game stops matching itself from store to store.
  const html = tile('Assassin&rsquo;s Creed Mirage', 'Standard Edition', '$49.99');
  const pick = pickGameTile(parseTiles(html), 'assassin s creed mirage');
  assert.equal(pick.value, 49.99);
});
