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

/**
 * The wider list, shown only when the user asks for it.
 *
 * These are real currencies with real published rates, but no shop this tool
 * reads prices from quotes in them. A price shown in one is our conversion of
 * a shekel figure, which is a useful thing to know and is NOT what any store
 * will charge — which is exactly what the warning beside the switch says.
 *
 * WHAT IS DELIBERATELY ABSENT, and why, so the list can be argued with rather
 * than guessed at. Not included: IRR (Iran), SYP (Syria), KPW (North Korea),
 * CUP (Cuba), AFN (Afghanistan), SDG (Sudan), VES (Venezuela), MMK (Myanmar),
 * BYN (Belarus), LBP (Lebanon), YER (Yemen), SOS (Somalia), LYD (Libya),
 * IQD (Iraq). Every one of them sits under a comprehensive embargo, an
 * Israeli trade prohibition, or has no functioning convertible market — so a
 * "price" in any of them describes a purchase nobody reading this can lawfully
 * make. RUB is included: Russia is sanctioned in ways that affect payment
 * rails, not a jurisdiction an Israeli may not transact with at all, and
 * Steam still publishes rouble prices people genuinely compare against.
 */
export const EXTRA_CURRENCIES: Currency[] = [
  { code: 'RUB', symbol: '₽', nameHe: 'רובל רוסי' },
  { code: 'CZK', symbol: 'Kč', nameHe: 'קורונה צ׳כית' },
  { code: 'HUF', symbol: 'Ft', nameHe: 'פורינט הונגרי' },
  { code: 'RON', symbol: 'lei', nameHe: 'לאו רומני' },
  { code: 'BGN', symbol: 'лв', nameHe: 'לב בולגרי' },
  { code: 'HRK', symbol: 'kn', nameHe: 'קונה קרואטית' },
  { code: 'RSD', symbol: 'дин', nameHe: 'דינר סרבי' },
  { code: 'ISK', symbol: 'kr', nameHe: 'כתר איסלנדי' },
  { code: 'DKK', symbol: 'kr', nameHe: 'כתר דני' },
  { code: 'NZD', symbol: 'NZ$', nameHe: 'דולר ניו־זילנדי' },
  { code: 'EGP', symbol: 'E£', nameHe: 'לירה מצרית' },
  { code: 'MAD', symbol: 'MAD', nameHe: 'דירהם מרוקאי' },
  { code: 'JOD', symbol: 'JD', nameHe: 'דינר ירדני' },
  { code: 'BHD', symbol: 'BD', nameHe: 'דינר בחרייני' },
  { code: 'KWD', symbol: 'KD', nameHe: 'דינר כווייתי' },
  { code: 'OMR', symbol: 'OMR', nameHe: 'ריאל עומאני' },
  { code: 'QAR', symbol: 'QR', nameHe: 'ריאל קטארי' },
  { code: 'AZN', symbol: '₼', nameHe: 'מאנת אזרבייג׳ני' },
  { code: 'GEL', symbol: '₾', nameHe: 'לארי גיאורגי' },
  { code: 'AMD', symbol: '֏', nameHe: 'דרם ארמני' },
  { code: 'UZS', symbol: 'soʼm', nameHe: 'סום אוזבקי' },
  { code: 'PKR', symbol: '₨', nameHe: 'רופי פקיסטני' },
  { code: 'BDT', symbol: '৳', nameHe: 'טאקה בנגלדשי' },
  { code: 'LKR', symbol: 'Rs', nameHe: 'רופי סרי־לנקי' },
  { code: 'NPR', symbol: 'Rs', nameHe: 'רופי נפאלי' },
  { code: 'KHR', symbol: '៛', nameHe: 'ריאל קמבודי' },
  { code: 'MNT', symbol: '₮', nameHe: 'טוגריק מונגולי' },
  { code: 'NGN', symbol: '₦', nameHe: 'נאירה ניגרית' },
  { code: 'KES', symbol: 'KSh', nameHe: 'שילינג קנייתי' },
  { code: 'GHS', symbol: 'GH₵', nameHe: 'סדי גאני' },
  { code: 'TZS', symbol: 'TSh', nameHe: 'שילינג טנזני' },
  { code: 'UGX', symbol: 'USh', nameHe: 'שילינג אוגנדי' },
  { code: 'ETB', symbol: 'Br', nameHe: 'בר אתיופי' },
  { code: 'DZD', symbol: 'DA', nameHe: 'דינר אלג׳יראי' },
  { code: 'TND', symbol: 'DT', nameHe: 'דינר תוניסאי' },
  { code: 'BOB', symbol: 'Bs', nameHe: 'בוליביאנו' },
  { code: 'PYG', symbol: '₲', nameHe: 'גוארני פרגוואי' },
  { code: 'UYU', symbol: '$U', nameHe: 'פזו אורוגוואי' },
  { code: 'CRC', symbol: '₡', nameHe: 'קולון קוסטה־ריקני' },
  { code: 'GTQ', symbol: 'Q', nameHe: 'קצל גואטמלי' },
  { code: 'DOP', symbol: 'RD$', nameHe: 'פזו דומיניקני' },
  { code: 'JMD', symbol: 'J$', nameHe: 'דולר ג׳מייקני' },
  { code: 'TTD', symbol: 'TT$', nameHe: 'דולר טרינידדי' },
  { code: 'MUR', symbol: '₨', nameHe: 'רופי מאוריציאני' },
  { code: 'MDL', symbol: 'L', nameHe: 'לאו מולדובי' },
  { code: 'MKD', symbol: 'ден', nameHe: 'דינר מקדוני' },
  { code: 'ALL', symbol: 'L', nameHe: 'לק אלבני' },
  { code: 'BAM', symbol: 'KM', nameHe: 'מארק בוסני' },
  { code: 'BWP', symbol: 'P', nameHe: 'פולה בוצוואני' },
  { code: 'NAD', symbol: 'N$', nameHe: 'דולר נמיבי' },
  { code: 'ZMW', symbol: 'ZK', nameHe: 'קוואצ׳ה זמבית' },
  { code: 'XOF', symbol: 'CFA', nameHe: 'פרנק מערב־אפריקאי' },
  { code: 'XAF', symbol: 'FCFA', nameHe: 'פרנק מרכז־אפריקאי' },
  { code: 'FJD', symbol: 'FJ$', nameHe: 'דולר פיג׳י' },
  { code: 'PGK', symbol: 'K', nameHe: 'קינה פפואית' },
  { code: 'BND', symbol: 'B$', nameHe: 'דולר ברוניי' },
  { code: 'MOP', symbol: 'MOP$', nameHe: 'פטקה מקאואנית' },
  { code: 'LAK', symbol: '₭', nameHe: 'קיפ לאוסי' },
  { code: 'MVR', symbol: 'Rf', nameHe: 'רופיה מלדיבית' },
];

/** Everything, for the picker when the wider list is switched on. */
export const WIDE_CURRENCIES: Currency[] = [...ALL_CURRENCIES, ...EXTRA_CURRENCIES];

// Built from BOTH lists: a currency chosen from the wider set still needs its
// symbol and Hebrew name wherever a price is printed.
const BY_CODE = new Map<string, Currency>();

for (const c of [...ALL_CURRENCIES, ...EXTRA_CURRENCIES]) BY_CODE.set(c.code, c);

export function currencyInfo(code: string): Currency {
  // An unknown code prints as its own name, which is what a currency with no
  // symbol does anyway (CHF, AED) and is never wrong — only plain.
  return BY_CODE.get(code) ?? { code, symbol: code, nameHe: code };
}
