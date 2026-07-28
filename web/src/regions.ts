/**
 * Region list for the preferred-region picker (mirrors the server's regions).
 * The preferred region is a global, persisted choice — the user's own market —
 * that pins to the top of every region comparison.
 */
export interface RegionMeta {
  market: string;
  nameHe: string;
  flag: string;
}

export const REGIONS: RegionMeta[] = [
  { market: 'IL', nameHe: 'ישראל', flag: '🇮🇱' },
  { market: 'US', nameHe: 'ארה״ב', flag: '🇺🇸' },
  { market: 'TR', nameHe: 'טורקיה', flag: '🇹🇷' },
  { market: 'AR', nameHe: 'ארגנטינה', flag: '🇦🇷' },
  { market: 'UA', nameHe: 'אוקראינה', flag: '🇺🇦' },
  { market: 'IN', nameHe: 'הודו', flag: '🇮🇳' },
  { market: 'BR', nameHe: 'ברזיל', flag: '🇧🇷' },
  { market: 'GB', nameHe: 'בריטניה', flag: '🇬🇧' },
  { market: 'CA', nameHe: 'קנדה', flag: '🇨🇦' },
  { market: 'JP', nameHe: 'יפן', flag: '🇯🇵' },
  { market: 'MX', nameHe: 'מקסיקו', flag: '🇲🇽' },
  { market: 'ZA', nameHe: 'דרום אפריקה', flag: '🇿🇦' },
  { market: 'CL', nameHe: 'צ׳ילה', flag: '🇨🇱' },
  { market: 'CO', nameHe: 'קולומביה', flag: '🇨🇴' },
  { market: 'PE', nameHe: 'פרו', flag: '🇵🇪' },
];

export const regionByMarket = new Map(REGIONS.map((r) => [r.market, r]));

const KEY = 'gp_preferred_region';

export function loadPreferredRegion(): string {
  try {
    return localStorage.getItem(KEY) || 'IL';
  } catch {
    return 'IL';
  }
}

export function savePreferredRegion(market: string): void {
  try {
    localStorage.setItem(KEY, market);
  } catch {
    /* ignore */
  }
}

/** Global "hide all game descriptions" preference. */
const HIDE_ALL_KEY = 'gp_hide_all_desc';
export function loadHideAllDesc(): boolean {
  try {
    return localStorage.getItem(HIDE_ALL_KEY) === '1';
  } catch {
    return false;
  }
}
export function saveHideAllDesc(v: boolean): void {
  try {
    localStorage.setItem(HIDE_ALL_KEY, v ? '1' : '0');
  } catch {
    /* ignore */
  }
}
