/**
 * Whether to show the bar that fills as each shop answers a search.
 *
 * On by default: a search that touches sixteen sources takes seconds, and a
 * blank screen for that long reads as a broken app rather than a busy one.
 *
 * There used to be a second preference here for a two-blink flourish when the
 * bar reached 100%. Nobody could ever see it, so the flourish and its switch
 * are both gone — a setting that changes nothing is worse than no setting.
 * Kept apart from the bar's own module so the settings screen can read this
 * without pulling a component in.
 */
const BAR_KEY = 'gp_search_progress';

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

