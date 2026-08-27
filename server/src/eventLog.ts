/**
 * A short, in-memory record of what has gone wrong lately.
 *
 * Built so a diagnostic report can say something. Without it, "a source is
 * failing" is a thing the user can see and nobody else can — the failure is a
 * caught exception in a fan-out, logged to a console nobody is reading, and by
 * the time anyone asks it is gone.
 *
 * DELIBERATELY IN MEMORY AND DELIBERATELY SMALL. This is not an audit trail and
 * must never become one: it holds the last few dozen events, it dies with the
 * process, and nothing here is written to disk. A tool whose whole claim is
 * that your data stays on your machine should not quietly start keeping a file
 * of everything you did.
 *
 * What it must never contain: an API key, the PlayStation hash, a note, or a
 * game title tied to a person. Messages are about SOURCES and OPERATIONS, and
 * `record` truncates anything long enough to have smuggled something in.
 */

export type EventLevel = 'error' | 'warn' | 'info';

export interface LoggedEvent {
  at: string;
  level: EventLevel;
  /** Which part of the tool — an adapter id, a route, a subsystem. */
  scope: string;
  message: string;
}

/** Enough to see a pattern, few enough that it cannot grow into a record. */
const MAX_EVENTS = 60;
/** Long enough for a real error, short enough that a key cannot hide in one. */
const MAX_MESSAGE = 300;

const events: LoggedEvent[] = [];

/**
 * Anything shaped like a credential, blanked before it is stored.
 *
 * Belt and braces: nothing here should be passing keys in the first place, but
 * a diagnostic report is a file people send to strangers, and "we were careful
 * at every call site" is not a property anybody can verify later.
 */
const SECRETS = [
  /\bkey=[^\s&]+/gi,
  /\bapikey=[^\s&]+/gi,
  /\btoken=[^\s&]+/gi,
  /\b[0-9a-f]{32,}\b/gi, // the PSN hash, and most API keys
];

function scrub(text: string): string {
  let out = text;
  for (const pattern of SECRETS) out = out.replace(pattern, '[redacted]');
  return out.slice(0, MAX_MESSAGE);
}

export function record(level: EventLevel, scope: string, message: unknown): void {
  const text = message instanceof Error ? message.message : String(message ?? '');
  events.push({
    at: new Date().toISOString(),
    level,
    scope: String(scope).slice(0, 60),
    message: scrub(text),
  });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** Newest first, which is the order anybody reads a log in. */
export function recentEvents(): LoggedEvent[] {
  return [...events].reverse();
}

export function clearEvents(): void {
  events.length = 0;
}

/** How many of each level, for a report's summary line. */
export function eventCounts(): Record<EventLevel, number> {
  const counts: Record<EventLevel, number> = { error: 0, warn: 0, info: 0 };
  for (const e of events) counts[e.level]++;
  return counts;
}
