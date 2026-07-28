/**
 * A one-line app event bus, currently used for a single thing: a price check can
 * fire a sale alert, and the bell should show it immediately rather than up to a
 * minute later when its poll comes round. Whoever triggers a check announces it;
 * the bell listens. Keeps the two from having to know about each other.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to "prices were just checked"; returns the unsubscribe function. */
export function onPricesChecked(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function pricesChecked(): void {
  for (const fn of listeners) fn();
}
