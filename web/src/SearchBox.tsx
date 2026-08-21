import { useEffect, useId, useRef, useState } from 'react';
import { api } from './api';
import { t } from './he';

/**
 * The search box, with title autocomplete.
 *
 * Two things it has to get right that a plain input didn't:
 *
 * 1. ENTER SUBMITS. It lives in a real <form> so the browser's own submit
 *    behaviour applies — the previous keydown handler missed Enter whenever the
 *    key event was swallowed (IME composition, autofill, a stray re-render), and
 *    "Enter sometimes does nothing" is the kind of bug users blame themselves
 *    for. When a suggestion is highlighted, Enter takes that instead.
 *
 * 2. IT NEVER RUNS THE REAL SEARCH ON A KEYSTROKE. Suggestions come from
 *    /api/suggest, which reads one fast catalog; the fifteen-source fan-out only
 *    ever runs when the user actually submits.
 *
 * Recent searches are kept locally and shown before anything has been typed, so
 * returning to a game you were watching is one keystroke.
 */

const RECENT_KEY = 'gp_recent_searches';
const MAX_RECENT = 6;
const DEBOUNCE_MS = 180;

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(term: string): void {
  const q = term.trim();
  if (!q) return;
  try {
    const next = [q, ...loadRecent().filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function SearchBox({
  query,
  setQuery,
  busy,
  placeholder,
  onSubmit,
}: {
  query: string;
  setQuery: (q: string) => void;
  busy: boolean;
  placeholder: string;
  /** Runs the real search. Called with the exact term to search. */
  onSubmit: (term: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [open, setOpen] = useState(false);
  /** -1 = nothing highlighted, so Enter submits what was typed. */
  const [active, setActive] = useState(-1);
  /** True while the user is mid-composition (Hebrew/IME); Enter then commits text, not the form. */
  const composing = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const showingRecent = query.trim().length < 2;
  const items = showingRecent ? recent : suggestions;

  // Fetch suggestions for what's typed, newest request wins, older ones aborted.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      api
        .suggest(q, ctl.signal)
        .then((r) => setSuggestions(r.suggestions))
        // An aborted or failed suggest is a non-event: the box keeps working.
        .catch(() => undefined);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query]);

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => setActive(-1), [query]);

  const submit = (term: string) => {
    const q = term.trim();
    if (!q) return;
    rememberSearch(q);
    setRecent(loadRecent());
    setOpen(false);
    setActive(-1);
    onSubmit(q);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composing.current) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (items.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return next < -1 ? items.length - 1 : next >= items.length ? -1 : next;
      });
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key === 'Enter') {
      // Handled here AND by the form's own submit, on purpose. Implicit form
      // submission is the standard path, but "Enter sometimes does nothing" was
      // a real complaint about the old box, and a search is the one action that
      // must never silently no-op. preventDefault stops the two paths from both
      // firing; submit() is idempotent for the user either way.
      e.preventDefault();
      const chosen = open && active >= 0 ? items[active] : undefined;
      if (chosen) setQuery(chosen);
      submit(chosen ?? query);
    }
  };

  return (
    <div className="searchbox" ref={boxRef}>
      <form
        className="searchbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(query);
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          placeholder={placeholder}
          autoFocus
          autoComplete="off"
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        />
        <button type="submit" disabled={busy}>
          {busy ? t.searching : t.searchButton}
        </button>
      </form>

      {open && items.length > 0 && (
        <ul className="suggest" id={listId} role="listbox" aria-label={showingRecent ? t.searchRecent : t.searchSuggestLabel}>
          <li className="suggest-head" role="presentation">
            {showingRecent ? t.searchRecent : t.searchSuggestLabel}
          </li>
          {items.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`suggest-item ${i === active ? 'on' : ''}`}
              // mousedown, not click: the input's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                setQuery(s);
                submit(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
