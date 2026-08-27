/**
 * Whether to show the search progress bar, and whether its final number blinks.
 *
 * Both are on by default and both can be turned off, because a moving bar is
 * reassuring to most people and a flashing number is genuinely unpleasant to
 * some — including anyone who has asked their system not to animate things.
 * Kept apart from the bar's own module so the settings screen can read them
 * without pulling a component in.
 */
import { loadMotionPref, saveMotionPref } from './prefs';

const BAR_KEY = 'gp_search_progress';
const BLINK_KEY = 'gp_search_progress_blink';

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

function write(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* private browsing; the preference simply will not persist */
  }
}

export const loadProgressBar = () => read(BAR_KEY);
export const saveProgressBar = (on: boolean) => write(BAR_KEY, on);

/**
 * The blink takes the OS preference as a DEFAULT, not as a veto.
 *
 * It used to check the media query FIRST and return false without ever looking
 * at what the user had stored — so turning the blink on in Settings worked
 * until the next navigation, when the component remounted, asked again, and got
 * false. The switch appeared to turn itself off. See loadMotionPref in prefs.ts
 * for the rule, which two other settings had got wrong in the same way.
 */
export const loadProgressBlink = () => loadMotionPref(BLINK_KEY);
export const saveProgressBlink = (on: boolean) => saveMotionPref(BLINK_KEY, on);
