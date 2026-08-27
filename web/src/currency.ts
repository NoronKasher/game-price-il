import { QUICK_CURRENCIES, currencyInfo } from './currencies';

/**
 * Display-currency conversion. Every price in the tool is stored and served in
 * ILS; this converts an ILS amount to the user's chosen display currency and
 * formats it. The config is module-level so the existing `nis()` formatter (and
 * anything else) can read it without prop-drilling; the App updates it and then
 * re-renders, so all prices reformat at once.
 */

/**
 * Any ISO code the rate feed knows. It was a union of three, which is why the
 * settings page's currency section had nothing to offer: the header already
 * held all three buttons, so the section could only restate them.
 */
export type CurrencyCode = string;
export const CURRENCIES: CurrencyCode[] = QUICK_CURRENCIES;

let code: CurrencyCode = 'ILS';
/**
 * A SECOND currency shown beside the first, when the user wants one.
 *
 * The case it exists for: the board converts a Turkish or Ukrainian price into
 * shekels, and the buyer wants both — what the tool is comparing, and what the
 * store will actually charge. One number cannot answer that.
 */
let secondary: CurrencyCode | null = null;
/** Units of each currency per 1 ILS (from the server; 1 == ILS itself). */
let ratesFromILS: Record<string, number> = { ILS: 1 };

export function setCurrencyConfig(
  c: CurrencyCode,
  rates: Record<string, number>,
  second: CurrencyCode | null = null
): void {
  code = c;
  ratesFromILS = { ...rates, ILS: 1 };
  // A secondary equal to the primary would print every price twice.
  secondary = second && second !== c ? second : null;
}

export function currencyCode(): CurrencyCode {
  return code;
}

export function secondaryCurrency(): CurrencyCode | null {
  return secondary;
}

/** True when the feed can price this code right now. */
export function canShow(c: CurrencyCode): boolean {
  return c === 'ILS' || (ratesFromILS[c] ?? 0) > 0;
}

export function currencySymbol(c: CurrencyCode = code): string {
  return currencyInfo(c).symbol;
}

/** One amount in one currency, formatted. */
function one(amountILS: number, c: CurrencyCode): string {
  const v = amountILS * (ratesFromILS[c] ?? 1);
  const info = currencyInfo(c);
  // Currencies without a minor unit look absurd with two decimals: ₩1,234.00
  // and ¥5,980.00 are not how anybody writes them.
  const minor = ZERO_DECIMAL.has(c) ? 0 : 2;
  const n = v.toLocaleString('he-IL', { minimumFractionDigits: minor, maximumFractionDigits: minor });
  // A multi-letter code reads as a prefix with a space; a symbol does not.
  return info.symbol.length > 1 && /[A-Za-z]/.test(info.symbol) ? `${info.symbol} ${n}` : info.symbol + n;
}

/** Currencies that are not divided into hundredths. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'CLP', 'COP', 'IDR', 'VND', 'HUF', 'ISK']);

/**
 * Format an ILS amount in the active display currency (e.g. 100 → "$27.00"),
 * with the secondary alongside when one is set.
 */
export function money(amountILS: number): string {
  const primary = one(amountILS, code);
  return secondary ? `${primary} (${one(amountILS, secondary)})` : primary;
}

/**
 * Is a price move real, or just exchange-rate drift? Foreign prices are stored
 * in ILS, converted at capture time, so the series wobbles a few agorot whenever
 * the rate moves while the store's own price sits still. Showing "▲ $0.02" for
 * that is noise dressed as news.
 *
 * Mirrors MIN_CHANGE_* in server/src/alerts.ts, which gates the same decision for
 * notifications — keep the two in sync so the list and the bell never disagree.
 */
export function isMeaningfulChange(currentILS: number, prevILS: number): boolean {
  const diff = Math.abs(currentILS - prevILS);
  if (diff < 1) return false;
  return prevILS > 0 ? (diff / prevILS) * 100 >= 1 : true;
}
