/**
 * Display-currency conversion. Every price in the tool is stored and served in
 * ILS; this converts an ILS amount to the user's chosen display currency and
 * formats it. The config is module-level so the existing `nis()` formatter (and
 * anything else) can read it without prop-drilling; the App updates it and then
 * re-renders, so all prices reformat at once.
 */

export type CurrencyCode = 'ILS' | 'USD' | 'EUR';
export const CURRENCIES: CurrencyCode[] = ['ILS', 'USD', 'EUR'];

const SYMBOL: Record<CurrencyCode, string> = { ILS: '₪', USD: '$', EUR: '€' };

let code: CurrencyCode = 'ILS';
/** Units of each currency per 1 ILS (from the server; 1 == ILS itself). */
let ratesFromILS: Record<CurrencyCode, number> = { ILS: 1, USD: 1, EUR: 1 };

export function setCurrencyConfig(c: CurrencyCode, rates: Record<CurrencyCode, number>): void {
  code = c;
  ratesFromILS = { ILS: 1, USD: rates.USD || 1, EUR: rates.EUR || 1 };
}

export function currencyCode(): CurrencyCode {
  return code;
}

export function currencySymbol(c: CurrencyCode = code): string {
  return SYMBOL[c];
}

/** Format an ILS amount in the active display currency (e.g. 100 → "$27.00"). */
export function money(amountILS: number): string {
  const v = amountILS * (ratesFromILS[code] ?? 1);
  return SYMBOL[code] + v.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
