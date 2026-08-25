import type { SourceStatus } from './types';

/**
 * Which "this store didn't answer" warnings the user has asked to stop seeing.
 *
 * The notice itself is worth keeping: a short result list because VGS is resting
 * reads exactly like "this game isn't sold in Israel", and that is a lie the
 * user would act on. But a store can be down for a week, and repeating the same
 * banner on every search for a week trains people to ignore all of them —
 * including the one that matters.
 *
 * So there are two dismissals, and the difference between them is the point:
 *
 *   FOR A DAY  — "yes, I know." Stored with an expiry, so tomorrow's search
 *                tells the truth again without the user having to remember they
 *                once dismissed something.
 *   UNTIL BACK — no expiry. The banner stays quiet for that store until it
 *                actually returns data, and then the mute is dropped so the NEXT
 *                outage is news again.
 *
 * There is deliberately no "never again". A permanently silenced source failing
 * is indistinguishable from a game not being sold, which is the exact confusion
 * this notice exists to prevent — so even the longer of the two ends by itself,
 * on the one event that makes it safe to end.
 */

const KEY = 'gp_source_notice_hidden';
const DAY_MS = 24 * 60 * 60 * 1000;

/** `until` is an epoch ms, or 'back' for "when the store answers again". */
type Mute = { until: number | 'back' };
type Muted = Record<string, Mute>;

function load(): Muted {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Muted = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      // Tolerate the older shape (`true` meant "until back") rather than
      // throwing away a preference somebody already expressed.
      if (v === true) out[id] = { until: 'back' };
      else if (v && typeof v === 'object') {
        const u = (v as { until?: unknown }).until;
        if (u === 'back' || (typeof u === 'number' && Number.isFinite(u))) out[id] = { until: u };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function save(muted: Muted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(muted));
  } catch {
    /* private browsing; the preference simply will not persist */
  }
}

/** "I know about this" — quiet until tomorrow. */
export function muteForADay(id: string): void {
  save({ ...load(), [id]: { until: Date.now() + DAY_MS } });
}

/** Quiet until this store actually returns data again. */
export function muteUntilBack(id: string): void {
  save({ ...load(), [id]: { until: 'back' } });
}

function isMuted(m: Mute | undefined): boolean {
  if (!m) return false;
  return m.until === 'back' || m.until > Date.now();
}

/**
 * Drop the mute for every source that came back with something.
 *
 * "Until we can get data from them again" is taken literally: answering with an
 * error does not count, and neither does answering with nothing. Called on each
 * result, so the moment a store is useful again its next failure is news.
 * Returns true when anything changed, so the caller can re-render.
 */
export function clearMutesForWorkingSources(sources: SourceStatus[]): boolean {
  const muted = load();
  let changed = false;
  for (const s of sources) {
    if (s.ok && s.count > 0 && muted[s.id]) {
      delete muted[s.id];
      changed = true;
    }
  }
  // Day-long mutes that have simply run out, tidied on the way past.
  for (const [id, m] of Object.entries(muted)) {
    if (!isMuted(m)) {
      delete muted[id];
      changed = true;
    }
  }
  if (changed) save(muted);
  return changed;
}

/** The failures still worth showing. */
export function visibleFailures(sources: SourceStatus[] | undefined): SourceStatus[] {
  const muted = load();
  return (sources ?? []).filter((s) => !s.ok && !isMuted(muted[s.id]));
}

/** For the settings screen: which stores are currently silenced, and how. */
export function mutedSources(): { id: string; until: number | 'back' }[] {
  return Object.entries(load())
    .filter(([, m]) => isMuted(m))
    .map(([id, m]) => ({ id, until: m.until }));
}

export function unmuteAll(): void {
  save({});
}
