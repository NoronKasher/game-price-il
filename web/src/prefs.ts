/**
 * Every choice this app remembers in the browser, in one place.
 *
 * These are the small decisions people make once and expect to stay made: the
 * notices they dismissed for good, the progress bar they switched off, the
 * region they prefer, whether descriptions are collapsed. Individually trivial;
 * together they are the difference between an app that feels like yours and one
 * that greets you the same way every time.
 *
 * They live in localStorage, which is right — they are per-browser, they must
 * apply instantly, and they have no business on a server. But that also meant
 * they were the one thing that did NOT travel: you could carry your whole
 * tracked list to another machine and still arrive to a fresh set of popups you
 * had already dismissed a month ago.
 *
 * So this module knows their names, and the portable token carries them. It
 * deliberately does NOT know what any of them mean: each key stays owned by the
 * module that reads it, and this one just collects and restores.
 *
 * The list is explicit rather than "everything starting with gp_". A prefix
 * sweep would quietly start carrying anything a future feature happens to
 * store — a draft, a cache, an id — and a token is a thing people paste to each
 * other.
 */

/** Keys that travel. Add a key here only when carrying it is actually wanted. */
const PORTABLE_KEYS = [
  'gp_search_progress',
  'gp_search_progress_blink',
  'gp_hide_region_notice',
  'gp_preferred_region',
  'gp_open_anim',
  'gp_hide_all_desc',
  'gp_board_view',
  'gp_source_notice_hidden',
  'gp_dlc_expanded',
  'gp_include_dlc',
  'gp_quiet_notices',
  'gp_ticker_motion',
  'gp_gamepass_alerts',
  'gp_gamepass_ack',
  'gp_owned_apps',
] as const;

/**
 * Deliberately NOT carried: `gp_recent_searches`.
 *
 * It is a history of what somebody typed, which is the one thing in here that
 * is about the person rather than about the app's appearance — and a token is
 * a string people send to each other. Carrying it would mean a shared list
 * quietly included a browsing history nobody thought to mention.
 */

export type PortablePrefs = Record<string, string>;

/** Everything currently set. Absent keys are simply absent, never defaulted. */
export function collectPrefs(): PortablePrefs {
  const out: PortablePrefs = {};
  try {
    for (const key of PORTABLE_KEYS) {
      const value = localStorage.getItem(key);
      if (value !== null) out[key] = value;
    }
  } catch {
    /* storage unavailable — a token without preferences is still a good token */
  }
  return out;
}

/**
 * Apply carried preferences.
 *
 * Only keys on the list above are written, however many the token claims: a
 * token is untrusted input, and "paste this to fix your prices" must not be a
 * way to write arbitrary keys into somebody's browser storage.
 */
export function applyPrefs(prefs: unknown): number {
  if (!prefs || typeof prefs !== 'object') return 0;
  const allowed = new Set<string>(PORTABLE_KEYS);
  let applied = 0;
  try {
    for (const [key, value] of Object.entries(prefs as Record<string, unknown>)) {
      if (!allowed.has(key) || typeof value !== 'string') continue;
      // A pasted value is still a value somebody chose; length is the only
      // thing worth bounding, so one bad key cannot fill the quota.
      if (value.length > 4096) continue;
      localStorage.setItem(key, value);
      applied++;
    }
  } catch {
    /* storage full or blocked; the tracked list still imported fine */
  }
  return applied;
}

/* ── Three switches that belong to nobody else ───────────────────────────── */

const TICKER_KEY = 'gp_ticker_motion';

/**
 * THE RULE FOR EVERY MOTION SETTING, in one place because it was got wrong in
 * three separate ones.
 *
 * The operating system's reduced-motion preference picks the DEFAULT. It is not
 * a veto. Reading it as one produced three bugs that all looked different:
 *
 *   the deals strip appeared frozen with no way to start it;
 *   the search bar's blink switched itself back off on every navigation,
 *     because the stored "on" was read AFTER the media query had already
 *     returned false and thrown it away;
 *   and the card-into-board flight never played, so the setting for it did
 *     nothing at all.
 *
 * Windows' "animation effects" switch is off on a great many machines and it is
 * about window transitions, not about whether a price tracker may move a strip
 * of text. A preference somebody can see and change beats one inferred from
 * their OS — so a stored choice always wins, and the OS is consulted only when
 * there is no stored choice to consult instead.
 */
export function loadMotionPref(key: string): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored === '1';
  } catch {
    /* storage unavailable; fall through to the OS default */
  }
  try {
    return !matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

export function saveMotionPref(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* private browsing; the preference simply will not persist */
  }
}

/**
 * The deals strip moves unless the user says otherwise.
 *
 * Not `loadMotionPref`, which would take its default from the OS. Windows'
 * animation switch is off on a great many machines and it is about window
 * transitions, not a news strip — and a first-run experience of a ticker that
 * sits frozen is one nobody goes looking in Settings to fix. The switch is
 * right there when they want it off.
 */
export function loadTickerMotion(): boolean {
  try {
    const stored = localStorage.getItem(TICKER_KEY);
    if (stored !== null) return stored === '1';
  } catch {
    /* storage unavailable */
  }
  return true;
}
export const saveTickerMotion = (on: boolean) => saveMotionPref(TICKER_KEY, on);

const QUIET_KEY = 'gp_quiet_notices';

/**
 * "Never show me the source and region notices at all."
 *
 * Separate from dismissing one notice: that is "not this one, for now", and
 * this is "I know how this tool works, stop explaining it". Someone who has
 * read that VGS is down and that a Turkish price needs a Turkish account does
 * not need to be told again every time either happens.
 */
export function loadQuietNotices(): boolean {
  try {
    return localStorage.getItem(QUIET_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveQuietNotices(on: boolean): void {
  try {
    localStorage.setItem(QUIET_KEY, on ? '1' : '0');
  } catch {
    /* nothing to do; the notices simply keep appearing */
  }
}
