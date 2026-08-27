/**
 * Which games the user says they already own.
 *
 * THEIR CLAIM, not something this tool works out. Reading a Steam library
 * needs an account and a key this project does not ask anybody for, and the
 * consoles will not answer the question at all without a logged-in session.
 * Ticking by hand is not a fallback for that — it is the only version that
 * works for every store rather than just the one with an API, and it costs
 * nobody a login.
 *
 * Kept per browser and carried in the portable token, because a list ticked
 * once should not need ticking again on the next machine. Ids are Steam app
 * ids today; anything else added later just needs to be unique, which is why
 * nothing here parses them.
 */

const KEY = 'gp_owned_apps';
/**
 * A ceiling on how many can be remembered.
 *
 * Large enough for a real library and bounded so the set cannot grow without
 * limit inside a token people paste to each other.
 */
const MAX_OWNED = 5000;

export function loadOwned(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function save(owned: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...owned].slice(0, MAX_OWNED)));
  } catch {
    /* private browsing; the ticks simply will not persist */
  }
}

/** Tick or untick one game. Returns the set as it now stands. */
export function toggleOwned(appId: string): Set<string> {
  const owned = loadOwned();
  if (owned.has(appId)) owned.delete(appId);
  else owned.add(appId);
  save(owned);
  return owned;
}
