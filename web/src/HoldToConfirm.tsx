import { useEffect, useRef, useState } from 'react';

/**
 * A destructive button that has to be held down.
 *
 * Used where a mis-click cannot be undone. A confirmation dialog would do the
 * same job, but people dismiss dialogs on reflex — holding for three seconds is
 * hard to do by accident and impossible to do without noticing, and the filling
 * bar means the user can see exactly how to back out: let go.
 *
 * Releasing early cancels and resets. Nothing is destroyed until the hold
 * completes, so there is no state where the action is half-done.
 */
export function HoldToConfirm({
  label,
  holding,
  done,
  ms = 3000,
  onConfirm,
  className = '',
}: {
  label: string;
  /** Shown while the button is held. */
  holding: string;
  /** Shown briefly after it fires. */
  done: string;
  ms?: number;
  onConfirm: () => void;
  className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const [fired, setFired] = useState(false);
  const start = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  const stop = () => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    frame.current = null;
    start.current = null;
    setProgress(0);
  };

  // Cancel on unmount, so a held button that navigates away cannot fire later.
  useEffect(() => stop, []);

  const begin = () => {
    if (fired) return;
    start.current = performance.now();
    const tick = (now: number) => {
      if (start.current == null) return;
      const p = Math.min(1, (now - start.current) / ms);
      setProgress(p);
      if (p >= 1) {
        stop();
        setFired(true);
        onConfirm();
        setTimeout(() => setFired(false), 2500);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const held = progress > 0;

  return (
    <button
      type="button"
      className={`holdbtn ${held ? 'holding' : ''} ${fired ? 'fired' : ''} ${className}`}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // Keyboard users get the same gesture: hold the key rather than tap it.
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={stop}
      onBlur={stop}
      aria-label={label}
    >
      <span className="holdbtn-fill" style={{ width: `${Math.round(progress * 100)}%` }} aria-hidden="true" />
      <span className="holdbtn-text">{fired ? done : held ? holding : label}</span>
    </button>
  );
}
