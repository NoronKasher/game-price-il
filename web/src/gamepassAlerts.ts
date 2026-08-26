/**
 * "Tell me when a game I am looking at is already on Game Pass."
 *
 * OFF BY DEFAULT, AND THAT IS THE WHOLE DESIGN. Most people do not subscribe,
 * and telling a non-subscriber that a game is free with a subscription they do
 * not have is noise dressed as a saving. So nothing here fires unless somebody
 * turned it on in Settings, which is also the only honest way to read "the game
 * is included" — it is included for people who pay for the service, and the
 * tool cannot know whether that is you.
 *
 * The badge on the board is a separate thing and always shows: that is a fact
 * about the catalogue, sitting next to the prices. This is an interruption, and
 * an interruption has to be asked for.
 *
 * Acknowledging is per game and permanent. "Yes, I know, stop telling me" is a
 * thing people should only have to say once — a tool that keeps raising the
 * same alert after being told is one whose bell gets ignored entirely, which
 * costs the real price drops too. Until it is acknowledged the alert can return
 * once a week, because a catalogue changes and a game you skipped in March may
 * matter in September.
 */

const ENABLED_KEY = 'gp_gamepass_alerts';
const STATE_KEY = 'gp_gamepass_ack';

/** How long before an unacknowledged game may raise the alert again. */
const REPEAT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** 'ack' = told us to stop. A number = epoch ms of the last alert. */
type GameState = 'ack' | number;

export function loadGamePassAlerts(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveGamePassAlerts(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? '1' : '0');
  } catch {
    /* storage blocked; the feature simply stays off */
  }
}

function readState(): Record<string, GameState> {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, GameState>) : {};
  } catch {
    return {};
  }
}

function writeState(state: Record<string, GameState>): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* the worst case is one repeated alert */
  }
}

/** Has this game been told "I know"? */
export function isAcknowledged(key: string): boolean {
  return readState()[key] === 'ack';
}

/**
 * Should an alert fire for this game right now?
 *
 * Pure of side effects on purpose — a render must be able to ask without
 * recording anything, or React's double-invocation in development would mark
 * games as alerted that never alerted.
 */
export function shouldAlert(key: string): boolean {
  if (!loadGamePassAlerts()) return false;
  const state = readState()[key];
  if (state === 'ack') return false;
  if (typeof state === 'number') return Date.now() - state > REPEAT_AFTER_MS;
  return true;
}

/** Record that the alert has just fired, so it does not fire again this week. */
export function markAlerted(key: string): void {
  const state = readState();
  if (state[key] === 'ack') return;
  state[key] = Date.now();
  writeState(state);
}

/** "I know." Permanent, per game. */
export function acknowledge(key: string): void {
  const state = readState();
  state[key] = 'ack';
  writeState(state);
}
