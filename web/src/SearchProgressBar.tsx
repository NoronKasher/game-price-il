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
 *   the filled part  — the stores that ANSWERED. Red at the start, amber
 *                      halfway, green at the end.
 *   the amber block  — the stores that could not be reached, sitting directly
 *                      after the fill rather than pinned to the far corner, so
 *                      the two together are what "done" means and the empty
 *                      track beyond them is what is still outstanding.
 *
 * A search where three of sixteen failed therefore reaches the end of the track
 * with a fifth of it amber: finished, but not complete, which are not the same
 * claim. The banner beneath names exactly those stores.
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
  onHidden,
}: {
  progress: ProgressState | null;
  /** The settings toggle: some people find a flashing number worse than useless. */
  onHidden: () => void;
}) {
  const [phase, setPhase] = useState<'running' | 'gone'>('running');

  const complete = progress != null && progress.total > 0 && progress.done >= progress.total;

  useEffect(() => {
    if (!complete) {
      setPhase('running');
      return;
    }
    // A short beat at 100%, then out — a progress bar that stays at 100% is
    // furniture. There used to be a two-blink flourish here that nobody could
    // ever see, including the person who asked for it, so it is gone along
    // with its setting.
    const timer = setTimeout(() => {
      setPhase('gone');
      onHidden();
    }, 350);
    return () => clearTimeout(timer);
  }, [complete, onHidden]);

  if (!progress || phase === 'gone' || progress.total === 0) return null;

  const fraction = Math.min(1, progress.done / progress.total);
  const pct = Math.round(fraction * 100);
  // Split the completed part in two: reached, and not reached. They sit side by
  // side and together they are `fraction`.
  const okShare = Math.min(1, progress.answered / progress.total);
  const failedShare = Math.max(0, fraction - okShare);

  return (
    <div
      className={`searchprog ${phase === 'running' ? 'blink' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={t.searchProgressLabel(progress.done, progress.total)}
    >
      <div className="searchprog-track">
        <div
          className="searchprog-fill"
          style={{ width: `${Math.round(okShare * 100)}%`, background: fillColour(fraction) }}
        />
        {/* Butted against the fill, not against the far corner: these stores are
            part of what has finished, they just finished with nothing. */}
        {failedShare > 0 && (
          <div
            className="searchprog-failed"
            style={{
              width: `${Math.round(failedShare * 100)}%`,
              insetInlineStart: `${Math.round(okShare * 100)}%`,
            }}
          />
        )}
      </div>
      <span className="searchprog-pct">{pct}%</span>
      <span className="searchprog-count">{t.searchProgressCount(progress.done, progress.total)}</span>
    </div>
  );
}
