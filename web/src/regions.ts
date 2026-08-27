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

// Mirror of the server's region roster (server/src/regions.ts) — keep in sync.
export const REGIONS: RegionMeta[] = [
  { market: 'IL', nameHe: 'ישראל', flag: '🇮🇱' },
  { market: 'US', nameHe: 'ארה״ב', flag: '🇺🇸' },
  { market: 'TR', nameHe: 'טורקיה', flag: '🇹🇷' },
  { market: 'AR', nameHe: 'ארגנטינה', flag: '🇦🇷' },
  { market: 'IN', nameHe: 'הודו', flag: '🇮🇳' },
  { market: 'UA', nameHe: 'אוקראינה', flag: '🇺🇦' },
  { market: 'BR', nameHe: 'ברזיל', flag: '🇧🇷' },
  { market: 'KZ', nameHe: 'קזחסטן', flag: '🇰🇿' },
  { market: 'ZA', nameHe: 'דרום אפריקה', flag: '🇿🇦' },
  { market: 'MX', nameHe: 'מקסיקו', flag: '🇲🇽' },
  { market: 'GB', nameHe: 'בריטניה', flag: '🇬🇧' },
  { market: 'CA', nameHe: 'קנדה', flag: '🇨🇦' },
  { market: 'DE', nameHe: 'גרמניה', flag: '🇩🇪' },
  { market: 'FR', nameHe: 'צרפת', flag: '🇫🇷' },
  { market: 'PL', nameHe: 'פולין', flag: '🇵🇱' },
  { market: 'JP', nameHe: 'יפן', flag: '🇯🇵' },
  { market: 'KR', nameHe: 'קוריאה', flag: '🇰🇷' },
  { market: 'HK', nameHe: 'הונג קונג', flag: '🇭🇰' },
  { market: 'SG', nameHe: 'סינגפור', flag: '🇸🇬' },
  { market: 'TW', nameHe: 'טייוואן', flag: '🇹🇼' },
  { market: 'TH', nameHe: 'תאילנד', flag: '🇹🇭' },
  { market: 'ID', nameHe: 'אינדונזיה', flag: '🇮🇩' },
  { market: 'MY', nameHe: 'מלזיה', flag: '🇲🇾' },
  { market: 'PH', nameHe: 'הפיליפינים', flag: '🇵🇭' },
  { market: 'VN', nameHe: 'וייטנאם', flag: '🇻🇳' },
  { market: 'CL', nameHe: 'צ׳ילה', flag: '🇨🇱' },
  { market: 'CO', nameHe: 'קולומביה', flag: '🇨🇴' },
  { market: 'PE', nameHe: 'פרו', flag: '🇵🇪' },
  { market: 'AU', nameHe: 'אוסטרליה', flag: '🇦🇺' },
  { market: 'SA', nameHe: 'ערב הסעודית', flag: '🇸🇦' },
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

/**
 * Global "animate a search card opening into its price board" preference.
 * On by default; the settings page can turn it off for instant opens (and
 * `prefers-reduced-motion` disables the motion regardless of this flag).
 */
import { loadMotionPref } from './prefs';

const OPEN_ANIM_KEY = 'gp_open_anim';
/**
 * The card-into-board flight. Same rule as every other motion setting: the OS
 * preference picks the default, the stored choice always wins. See
 * loadMotionPref in prefs.ts.
 */
export function loadOpenAnim(): boolean {
  return loadMotionPref(OPEN_ANIM_KEY);
}
export function saveOpenAnim(v: boolean): void {
  try {
    localStorage.setItem(OPEN_ANIM_KEY, v ? '1' : '0');
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

/**
 * How the departure board lays out a long list of offers.
 *
 * A PC game can now produce ~70 rows (two storefronts × ~30 regions each), which
 * is a wall, not a comparison — so the default collapses each storefront to its
 * best region with a per-store expander. The other modes are kept because the
 * right answer depends on the user: someone hunting arbitrage wants every row.
 *
 *  collapse — one row per storefront (its cheapest region), expandable
 *  pinned   — Israel + the default country first, then everything cheapest-first
 *  top      — the cheapest 12 rows, with a "show the rest" button
 *  full     — every row, cheapest-first (the original behaviour)
 */
export type BoardView = 'collapse' | 'pinned' | 'top' | 'full';
export const BOARD_VIEWS: BoardView[] = ['collapse', 'pinned', 'top', 'full'];

const BOARD_VIEW_KEY = 'gp_board_view';

export function loadBoardView(): BoardView {
  try {
    const v = localStorage.getItem(BOARD_VIEW_KEY);
    return BOARD_VIEWS.includes(v as BoardView) ? (v as BoardView) : 'collapse';
  } catch {
    return 'collapse';
  }
}

export function saveBoardView(v: BoardView): void {
  try {
    localStorage.setItem(BOARD_VIEW_KEY, v);
  } catch {
    /* ignore */
  }
}
