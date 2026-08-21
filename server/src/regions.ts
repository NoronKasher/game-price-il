/**
 * Console/PC store regions. Israelis routinely buy games on foreign-region
 * accounts, so the region board compares the same game's price across every
 * region — each in its native currency and converted to ₪.
 *
 * `pinned` regions surface at the top of the board (the ones Israeli gamers use
 * most — the classic cheap markets); the rest are shown below, still sorted
 * cheapest-first. `market` is the ISO 3166-1 alpha-2 country code the store APIs
 * accept. `currency` is the region's nominal currency for display only — every
 * adapter reads the ACTUAL charged currency off the store's own response (some
 * stores bill LATAM/others in USD), so conversion never relies on this field.
 *
 * Not every store serves every region: each adapter maps this list to what it
 * supports and silently skips the rest (an unsupported region simply shows no
 * row for that store), so this roster can stay broad without breaking anyone.
 */

export interface Region {
  /** ISO 3166-1 alpha-2, used as the store `market`/`country`/`cc` param. */
  market: string;
  nameHe: string;
  flag: string;
  currency: string;
  pinned: boolean;
}

export const REGIONS: Region[] = [
  // Pinned — home + the markets Israelis most often buy from for the deep cuts.
  { market: 'IL', nameHe: 'ישראל', flag: '🇮🇱', currency: 'ILS', pinned: true },
  { market: 'US', nameHe: 'ארה״ב', flag: '🇺🇸', currency: 'USD', pinned: true },
  { market: 'TR', nameHe: 'טורקיה', flag: '🇹🇷', currency: 'TRY', pinned: true },
  { market: 'AR', nameHe: 'ארגנטינה', flag: '🇦🇷', currency: 'ARS', pinned: true },
  { market: 'IN', nameHe: 'הודו', flag: '🇮🇳', currency: 'INR', pinned: true },
  { market: 'UA', nameHe: 'אוקראינה', flag: '🇺🇦', currency: 'UAH', pinned: true },
  { market: 'BR', nameHe: 'ברזיל', flag: '🇧🇷', currency: 'BRL', pinned: true },
  { market: 'KZ', nameHe: 'קזחסטן', flag: '🇰🇿', currency: 'KZT', pinned: true },
  { market: 'ZA', nameHe: 'דרום אפריקה', flag: '🇿🇦', currency: 'ZAR', pinned: true },
  { market: 'MX', nameHe: 'מקסיקו', flag: '🇲🇽', currency: 'MXN', pinned: true },
  // The rest — a broad global spread for comparison.
  { market: 'GB', nameHe: 'בריטניה', flag: '🇬🇧', currency: 'GBP', pinned: false },
  { market: 'CA', nameHe: 'קנדה', flag: '🇨🇦', currency: 'CAD', pinned: false },
  { market: 'DE', nameHe: 'גרמניה', flag: '🇩🇪', currency: 'EUR', pinned: false },
  { market: 'FR', nameHe: 'צרפת', flag: '🇫🇷', currency: 'EUR', pinned: false },
  { market: 'PL', nameHe: 'פולין', flag: '🇵🇱', currency: 'PLN', pinned: false },
  { market: 'JP', nameHe: 'יפן', flag: '🇯🇵', currency: 'JPY', pinned: false },
  { market: 'KR', nameHe: 'קוריאה', flag: '🇰🇷', currency: 'KRW', pinned: false },
  { market: 'HK', nameHe: 'הונג קונג', flag: '🇭🇰', currency: 'HKD', pinned: false },
  { market: 'SG', nameHe: 'סינגפור', flag: '🇸🇬', currency: 'SGD', pinned: false },
  { market: 'TW', nameHe: 'טייוואן', flag: '🇹🇼', currency: 'TWD', pinned: false },
  { market: 'TH', nameHe: 'תאילנד', flag: '🇹🇭', currency: 'THB', pinned: false },
  { market: 'ID', nameHe: 'אינדונזיה', flag: '🇮🇩', currency: 'IDR', pinned: false },
  { market: 'MY', nameHe: 'מלזיה', flag: '🇲🇾', currency: 'MYR', pinned: false },
  { market: 'PH', nameHe: 'הפיליפינים', flag: '🇵🇭', currency: 'PHP', pinned: false },
  { market: 'VN', nameHe: 'וייטנאם', flag: '🇻🇳', currency: 'VND', pinned: false },
  { market: 'CL', nameHe: 'צ׳ילה', flag: '🇨🇱', currency: 'CLP', pinned: false },
  { market: 'CO', nameHe: 'קולומביה', flag: '🇨🇴', currency: 'COP', pinned: false },
  { market: 'PE', nameHe: 'פרו', flag: '🇵🇪', currency: 'PEN', pinned: false },
  { market: 'AU', nameHe: 'אוסטרליה', flag: '🇦🇺', currency: 'AUD', pinned: false },
  { market: 'SA', nameHe: 'ערב הסעודית', flag: '🇸🇦', currency: 'SAR', pinned: false },
];

export const regionByMarket = new Map(REGIONS.map((r) => [r.market, r]));
