import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from './he';

/**
 * Jump to a setting, or find one by name.
 *
 * The settings page has grown past the point where scrolling finds anything.
 * Someone looking for the alert rule should not have to remember whether it is
 * above or below the API keys — and it deliberately IS below, since the page is
 * ordered by what a mistake costs rather than by how often a thing is wanted.
 * That ordering is right and it makes a jump list necessary rather than nice.
 *
 * IT READS THE PAGE INSTEAD OF LISTING IT. A hand-written list of sections
 * would be a second place to update every time a section is added, and the one
 * everybody forgets — the failure would be silent, a heading simply missing
 * from the menu. So this walks the rendered headings on mount, which means a
 * new section appears here for free the moment it is rendered.
 *
 * The search matches the heading AND the descriptive text under it, because
 * "מטבע" is what people type and "מטבע תצוגה" is what the heading says, but
 * "לירה טורקית" only appears in the paragraph.
 */

interface Section {
  id: string;
  title: string;
  /** The heading plus its section's text, lowercased, for matching. */
  haystack: string;
  el: HTMLElement;
}

/** Turn a Hebrew heading into something usable as an id. */
function slug(text: string, index: number): string {
  const base = text.trim().replace(/\s+/g, '-').replace(/[^\w֐-׿-]/g, '');
  return `set-${index}-${base}`.slice(0, 60);
}

export function SettingsNav({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  // Read the headings the page actually rendered. Runs after paint, and again
  // whenever the page's content changes — a panel that loads its data async
  // (the API keys, PlayStation) adds its heading late.
  useEffect(() => {
    const root = container.current;
    if (!root) return;

    const read = () => {
      const found: Section[] = [];
      root.querySelectorAll<HTMLElement>('h2').forEach((h, i) => {
        const title = h.textContent?.trim();
        if (!title) return;
        if (!h.id) h.id = slug(title, i);
        // Everything from this heading to the next one is its section, which is
        // what makes searching by a word from the body text work.
        let text = title;
        for (let node = h.nextElementSibling; node && node.tagName !== 'H2'; node = node.nextElementSibling) {
          text += ' ' + (node.textContent ?? '');
        }
        found.push({ id: h.id, title, haystack: text.toLowerCase(), el: h });
      });
      setSections((prev) =>
        prev.length === found.length && prev.every((p, i) => p.id === found[i]?.id) ? prev : found
      );
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container]);

  // Which section the reader is currently in, so the menu says where they are.
  useEffect(() => {
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) setActive(visible[0]!.target.id);
      },
      // A band near the top: the heading that has just scrolled into the
      // reading position, not whatever happens to be biggest on screen.
      { rootMargin: '-80px 0px -70% 0px' }
    );
    for (const s of sections) observer.observe(s.el);
    return () => observer.disconnect();
  }, [sections]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter((s) => s.haystack.includes(q));
  }, [sections, query]);

  if (sections.length === 0) return null;

  const jump = (section: Section) => {
    section.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // A brief highlight, because scrolling to a heading that looks like every
    // other heading leaves people unsure whether anything happened.
    section.el.classList.add('set-flash');
    window.setTimeout(() => section.el.classList.remove('set-flash'), 1200);
  };

  return (
    <nav className="setnav" ref={navRef} aria-label={t.setNavLabel}>
      <input
        className="setnav-search"
        type="search"
        value={query}
        placeholder={t.setNavSearch}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter on a single match is the fast path for somebody who knows
          // what they are looking for.
          if (e.key === 'Enter' && matches.length > 0) jump(matches[0]!);
        }}
      />
      {matches.length === 0 ? (
        <p className="setnav-empty">{t.setNavNone(query)}</p>
      ) : (
        <ul className="setnav-list">
          {matches.map((s) => (
            <li key={s.id}>
              <button
                className={`setnav-item ${active === s.id && !query ? 'on' : ''}`}
                onClick={() => jump(s)}
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
