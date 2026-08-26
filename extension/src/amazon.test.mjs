import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, readAsin } from './amazon.ts';

/**
 * Reading a price off a page we do not control.
 *
 * Amazon pages are dense with digits — ratings, review counts, "3 offers from",
 * delivery dates — so a loose parse cheerfully records a star rating as a price.
 * These pin the two things that decide whether a stored number is real: the
 * currency must be identified, and the decimal separator must be the right one.
 */

test('the common currency shapes are read', () => {
  assert.deepEqual(parsePrice('₪189.90'), { price: 189.9, currency: 'ILS' });
  assert.deepEqual(parsePrice('$59.99'), { price: 59.99, currency: 'USD' });
  assert.deepEqual(parsePrice('£49.99'), { price: 49.99, currency: 'GBP' });
  assert.deepEqual(parsePrice('¥5980'), { price: 5980, currency: 'JPY' });
});

test('European and Anglo decimal separators both come out right', () => {
  // The LAST separator is the decimal one. Getting this backwards turns
  // €1.234,56 into €1.23 — an error that looks like a bargain.
  assert.deepEqual(parsePrice('€1.234,56'), { price: 1234.56, currency: 'EUR' });
  assert.deepEqual(parsePrice('$1,234.56'), { price: 1234.56, currency: 'USD' });
  assert.deepEqual(parsePrice('€49,99'), { price: 49.99, currency: 'EUR' });
});

test('a number with no currency is refused', () => {
  // "4.7 out of 5 stars", "1,204 ratings" — all digits, none of them a price.
  assert.equal(parsePrice('4.7'), null);
  assert.equal(parsePrice('1,204 ratings'), null);
  assert.equal(parsePrice(''), null);
});

test('a currency with no number is refused', () => {
  assert.equal(parsePrice('$'), null);
  assert.equal(parsePrice('₪ --'), null);
});

test('a free or zero price is not a price', () => {
  assert.equal(parsePrice('$0.00'), null);
});

test('the ASIN is read from the URL shapes Amazon uses', () => {
  assert.equal(readAsin('https://www.amazon.com/dp/B0BXYZ1234'), 'B0BXYZ1234');
  assert.equal(readAsin('https://www.amazon.co.uk/gp/product/B0BXYZ1234/ref=abc?th=1'), 'B0BXYZ1234');
  assert.equal(readAsin('https://www.amazon.de/Some-Product-Name/dp/b0bxyz1234/'), 'B0BXYZ1234');
});

test('a page that is not a product yields no ASIN', () => {
  // Without one there is nothing stable to key a tracked row on, so no card.
  const emptyDom = { querySelector: () => null };
  assert.equal(readAsin('https://www.amazon.com/s?k=elden+ring', emptyDom), null);
  assert.equal(readAsin('https://www.amazon.com/', emptyDom), null);
});

test('a listing carries only the fees Amazon actually printed', () => {
  // The shape of AmazonListing makes the distinction explicit: absent means the
  // page did not say, never that the fee is zero. Israeli import fees are not a
  // flat percentage — they depend on category and declared value — so computing
  // one would be inventing a total, the same mistake the Eilat pricing made once.
  const printedNothing = { title: 'X', price: 100, currency: 'ILS', url: 'u', asin: 'A' };
  assert.equal(printedNothing.importFees, undefined);
  assert.equal(printedNothing.shipping, undefined);
});
