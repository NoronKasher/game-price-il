/**
 * Every currency the tool can display a price in.
 *
 * The header keeps three buttons — ₪, $, € — because those are what an Israeli
 * buyer compares against nine times out of ten, and a dropdown of a hundred
 * options at the top of every screen would be worse for everybody to serve the
 * tenth case.
 *
 * The tenth case is real though, and it is exactly the sort of question this
 * tool exists for: the board shows a Ukrainian or Turkish price converted to
 * shekels, and somebody wants to see what the store itself will actually charge
 * in hryvnia. That belongs in Settings, alongside the regions those prices come
 * from, rather than nowhere.
 *
 * The list is the regions the price board already covers, plus the majors. A
 * currency the rate feed cannot price is simply absent — see ratesFor.
 */

export interface Currency {
  code: string;
  symbol: string;
  nameHe: string;
}

/**
 * Ordered so the common three lead, then the regional board's own currencies in
 * the order those regions appear, then the rest of the majors.
 */
export const ALL_CURRENCIES: Currency[] = [
  { code: 'ILS', symbol: '₪', nameHe: 'שקל' },
  { code: 'USD', symbol: '$', nameHe: 'דולר אמריקאי' },
  { code: 'EUR', symbol: '€', nameHe: 'אירו' },
  { code: 'GBP', symbol: '£', nameHe: 'לירה שטרלינג' },
  { code: 'TRY', symbol: '₺', nameHe: 'לירה טורקית' },
  { code: 'UAH', symbol: '₴', nameHe: 'הריבניה אוקראינית' },
  { code: 'ARS', symbol: 'AR$', nameHe: 'פזו ארגנטינאי' },
  { code: 'BRL', symbol: 'R$', nameHe: 'ריאל ברזילאי' },
  { code: 'INR', symbol: '₹', nameHe: 'רופי הודי' },
  { code: 'KZT', symbol: '₸', nameHe: 'טנגה קזחית' },
  { code: 'ZAR', symbol: 'R', nameHe: 'ראנד דרום־אפריקאי' },
  { code: 'MXN', symbol: 'MX$', nameHe: 'פזו מקסיקני' },
  { code: 'PLN', symbol: 'zł', nameHe: 'זלוטי פולני' },
  { code: 'JPY', symbol: '¥', nameHe: 'ין יפני' },
  { code: 'KRW', symbol: '₩', nameHe: 'וון דרום־קוריאני' },
  { code: 'CAD', symbol: 'CA$', nameHe: 'דולר קנדי' },
  { code: 'AUD', symbol: 'A$', nameHe: 'דולר אוסטרלי' },
  { code: 'CHF', symbol: 'CHF', nameHe: 'פרנק שוויצרי' },
  { code: 'SEK', symbol: 'kr', nameHe: 'כתר שוודי' },
  { code: 'NOK', symbol: 'kr', nameHe: 'כתר נורווגי' },
  { code: 'CNY', symbol: 'CN¥', nameHe: 'יואן סיני' },
  { code: 'HKD', symbol: 'HK$', nameHe: 'דולר הונג־קונגי' },
  { code: 'SGD', symbol: 'S$', nameHe: 'דולר סינגפורי' },
  { code: 'TWD', symbol: 'NT$', nameHe: 'דולר טאיוואני' },
  { code: 'THB', symbol: '฿', nameHe: 'באט תאילנדי' },
  { code: 'IDR', symbol: 'Rp', nameHe: 'רופיה אינדונזית' },
  { code: 'MYR', symbol: 'RM', nameHe: 'רינגיט מלזי' },
  { code: 'PHP', symbol: '₱', nameHe: 'פזו פיליפיני' },
  { code: 'VND', symbol: '₫', nameHe: 'דונג וייטנאמי' },
  { code: 'CLP', symbol: 'CL$', nameHe: 'פזו צ׳יליאני' },
  { code: 'COP', symbol: 'CO$', nameHe: 'פזו קולומביאני' },
  { code: 'PEN', symbol: 'S/', nameHe: 'סול פרואני' },
  { code: 'SAR', symbol: 'SR', nameHe: 'ריאל סעודי' },
  { code: 'AED', symbol: 'AED', nameHe: 'דירהם אמירתי' },
];

/** The three the header offers. Everything else lives in Settings. */
export const QUICK_CURRENCIES = ['ILS', 'USD', 'EUR'];

const BY_CODE = new Map(ALL_CURRENCIES.map((c) => [c.code, c]));

export function currencyInfo(code: string): Currency {
  // An unknown code prints as its own name, which is what a currency with no
  // symbol does anyway (CHF, AED) and is never wrong — only plain.
  return BY_CODE.get(code) ?? { code, symbol: code, nameHe: code };
}
