/**
 * Console store regions. Israelis routinely buy console games on foreign-region
 * accounts, so the region board compares the same game's price across every
 * region — each in its native currency and converted to ₪.
 *
 * `pinned` regions surface at the top of the board (the ones Israeli gamers
 * use most); the rest are shown below, still sorted cheapest-first.
 * `market` is the ISO country code accepted by the console store APIs.
 */

export interface Region {
  /** ISO 3166-1 alpha-2, used as the store `market`/`country` param. */
  market: string;
  nameHe: string;
  flag: string;
  currency: string;
  pinned: boolean;
}

export const REGIONS: Region[] = [
  { market: 'IL', nameHe: 'ישראל', flag: '🇮🇱', currency: 'ILS', pinned: true },
  { market: 'TR', nameHe: 'טורקיה', flag: '🇹🇷', currency: 'TRY', pinned: true },
  { market: 'AR', nameHe: 'ארגנטינה', flag: '🇦🇷', currency: 'ARS', pinned: true },
  { market: 'UA', nameHe: 'אוקראינה', flag: '🇺🇦', currency: 'UAH', pinned: true },
  { market: 'IN', nameHe: 'הודו', flag: '🇮🇳', currency: 'INR', pinned: true },
  { market: 'US', nameHe: 'ארה״ב', flag: '🇺🇸', currency: 'USD', pinned: true },
  { market: 'BR', nameHe: 'ברזיל', flag: '🇧🇷', currency: 'BRL', pinned: false },
  { market: 'GB', nameHe: 'בריטניה', flag: '🇬🇧', currency: 'GBP', pinned: false },
  { market: 'CA', nameHe: 'קנדה', flag: '🇨🇦', currency: 'CAD', pinned: false },
  { market: 'JP', nameHe: 'יפן', flag: '🇯🇵', currency: 'JPY', pinned: false },
  { market: 'MX', nameHe: 'מקסיקו', flag: '🇲🇽', currency: 'MXN', pinned: false },
  { market: 'ZA', nameHe: 'דרום אפריקה', flag: '🇿🇦', currency: 'ZAR', pinned: false },
  { market: 'CL', nameHe: 'צ׳ילה', flag: '🇨🇱', currency: 'CLP', pinned: false },
  { market: 'CO', nameHe: 'קולומביה', flag: '🇨🇴', currency: 'COP', pinned: false },
  { market: 'PE', nameHe: 'פרו', flag: '🇵🇪', currency: 'PEN', pinned: false },
];

export const regionByMarket = new Map(REGIONS.map((r) => [r.market, r]));
