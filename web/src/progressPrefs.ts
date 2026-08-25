/**
 * Whether to show the search progress bar, and whether its final number blinks.
 *
 * Both are on by default and both can be turned off, because a moving bar is
 * reassuring to most people and a flashing number is genuinely unpleasant to
 * some — including anyone who has asked their system not to animate things.
 * Kept apart from the bar's own module so the settings screen can read them
 * without pulling a component in.
 */
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
 * The blink also yields to the OS. Someone who set "reduce motion" has already
 * answered this question, and making them answer it again in our settings would
 * be ignoring what they said.
 */
export function loadProgressBlink(): boolean {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {
    /* no matchMedia; fall through to the stored preference */
  }
  return read(BLINK_KEY);
}
export const saveProgressBlink = (on: boolean) => write(BLINK_KEY, on);
