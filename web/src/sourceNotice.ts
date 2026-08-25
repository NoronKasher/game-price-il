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
 *   FOR NOW    — component state. Gone on the next search. For "yes, I know,
 *                let me read these results."
 *   UNTIL BACK — stored here, per source. The banner stays quiet for that store
 *                until it actually answers again, and then the dismissal is
 *                dropped so the NEXT outage is news again.
 *
 * There is deliberately no "never again". A permanently silenced source failing
 * is indistinguishable from a game not being sold, which is the exact confusion
 * this notice exists to prevent.
 */

const KEY = 'gp_source_notice_hidden';

type Hidden = Record<string, true>;

function load(): Hidden {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Hidden = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === true) out[id] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function save(hidden: Hidden): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(hidden));
  } catch {
    /* private browsing; the preference simply will not persist */
  }
}

/** Silence this source's warning until it answers again. */
export function muteSource(id: string): void {
  save({ ...load(), [id]: true });
}

/**
 * Drop the mute for every source that answered this time.
 *
 * Called on each result, so "until it's back" means what it says: the moment the
 * store returns, its next failure is worth telling the user about again.
 * Returns true when anything changed, so the caller can re-render.
 */
export function clearMutesForWorkingSources(sources: SourceStatus[]): boolean {
  const hidden = load();
  let changed = false;
  for (const s of sources) {
    if (s.ok && hidden[s.id]) {
      delete hidden[s.id];
      changed = true;
    }
  }
  if (changed) save(hidden);
  return changed;
}

/** The failures still worth showing: not muted, and not dismissed for this view. */
export function visibleFailures(sources: SourceStatus[] | undefined, dismissedNow: Set<string>): SourceStatus[] {
  const hidden = load();
  return (sources ?? []).filter((s) => !s.ok && !hidden[s.id] && !dismissedNow.has(s.id));
}

/** For the settings screen: how many stores are currently silenced. */
export function mutedSourceIds(): string[] {
  return Object.keys(load());
}

export function unmuteAll(): void {
  save({});
}
