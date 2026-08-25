import { useEffect, useState } from 'react';
import { t } from './he';

/**
 * How far through the stores a search is.
 *
 * The fan-out cannot beat its slowest source, and the slowest sources are the
 * Israeli shops this tool exists for — held to a 2.5s gap that is the scraping
 * ethic and is not moving. So the wait is real and cannot be shortened; what it
 * can stop being is *unexplained*. A bar that names how many of sixteen stores
 * have answered turns "it's stuck" into "it's working", which is the actual
 * complaint.
 *
 * TWO COLOURS, MEANING TWO DIFFERENT THINGS:
 *
 *   the filled part  — red at the start, amber halfway, green at the end. Simple
 *                      progress: how much of the work is done.
 *   the amber tail   — the share of stores that could not be reached. A search
 *                      where three of sixteen failed finishes full, but finishes
 *                      with a fifth of the bar amber, because "done" and
 *                      "complete" are not the same claim. The banner beneath
 *                      names those stores — same set, same meaning.
 *
 * That distinction is the whole reason this is not just a spinner: a spinner
 * that stops tells you the search ended, never that it ended short.
 */

export interface ProgressState {
  total: number;
  done: number;
  /**
   * Sources that ANSWERED — not sources that had results.
   *
   * A shop replying "we don't stock Celeste" is working perfectly; counting it
   * as missing turned a healthy search into a bar that was 60% amber. The amber
   * share means the same thing the banner underneath means: these stores could
   * not be reached, so the answer is genuinely incomplete.
   */
  answered: number;
}

/** Red → amber → green across the fill, as a plain hue sweep. */
function fillColour(fraction: number): string {
  // 0 → hue 0 (red), 0.5 → hue 38 (amber), 1 → hue 140 (green).
  const hue = fraction <= 0.5 ? fraction * 2 * 38 : 38 + (fraction - 0.5) * 2 * 102;
  return `hsl(${Math.round(hue)} 78% 48%)`;
}

export function SearchProgressBar({
  progress,
  blink,
  onHidden,
}: {
  progress: ProgressState | null;
  /** The settings toggle: some people find a flashing number worse than useless. */
  blink: boolean;
  onHidden: () => void;
}) {
  const [phase, setPhase] = useState<'running' | 'blinking' | 'gone'>('running');

  const complete = progress != null && progress.total > 0 && progress.done >= progress.total;

  useEffect(() => {
    if (!complete) {
      setPhase('running');
      return;
    }
    // Two blinks then out, or straight out when the user asked for no blinking.
    // Either way it leaves: a progress bar that stays at 100% is furniture.
    const blinkMs = blink ? 900 : 350;
    setPhase(blink ? 'blinking' : 'running');
    const timer = setTimeout(() => {
      setPhase('gone');
      onHidden();
    }, blinkMs);
    return () => clearTimeout(timer);
  }, [complete, blink, onHidden]);

  if (!progress || phase === 'gone' || progress.total === 0) return null;

  const fraction = Math.min(1, progress.done / progress.total);
  const pct = Math.round(fraction * 100);
  // The share that could not be reached at all.
  const emptyShare = progress.done > 0 ? (progress.done - progress.answered) / progress.total : 0;

  return (
    <div
      className={`searchprog ${phase === 'blinking' ? 'blink' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={t.searchProgressLabel(progress.done, progress.total)}
    >
      <div className="searchprog-track">
        <div
          className="searchprog-fill"
          style={{ width: `${pct}%`, background: fillColour(fraction) }}
        />
        {/* The empty-handed share, pinned to the far end so it reads as "this
            much of the answer is missing" rather than as progress. */}
        {emptyShare > 0 && (
          <div className="searchprog-empty" style={{ width: `${Math.round(emptyShare * 100)}%` }} />
        )}
      </div>
      <span className="searchprog-pct">{pct}%</span>
      <span className="searchprog-count">{t.searchProgressCount(progress.done, progress.total)}</span>
    </div>
  );
}
