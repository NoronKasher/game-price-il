import { readStorePage, type StorePage } from './storePage.ts';

/**
 * The card on a store's own product page.
 *
 * Same restraint as the Amazon panel, for the same reasons: it appears only when
 * a game was actually identified, it can be dismissed for the session, it sits
 * in a corner rather than over the page's controls, and it carries no
 * storefront's logo — putting somebody's mark on your UI implies a relationship
 * you do not have.
 *
 * One difference, and it is the important one: this panel does NOT compare
 * anything until it is asked to. It says which game it sees and offers a
 * button. A comparison is sixteen stores answering, and running one on every
 * product page a person idly opens would scale this tool's footprint with
 * browsing habits instead of with intent.
 *
 * Styles are inlined rather than injected: this element lives inside pages whose
 * CSS we do not control and must not disturb, and every declaration here is
 * scoped to elements we created.
 */

const PANEL_ID = 'vgpt-store-panel';
const DISMISS_KEY = 'vgpt-store-dismissed';

const PANEL_CSS = `
  position: fixed; inset-block-end: 18px; inset-inline-end: 18px; z-index: 2147483000;
  width: 300px; max-width: calc(100vw - 36px); padding: 13px 14px 12px; box-sizing: border-box;
  background: #0d1117; color: #e6edf3; border: 1px solid #222c3a; border-radius: 12px;
  box-shadow: 0 14px 38px rgba(0,0,0,.45);
  font: 13px/1.5 "Segoe UI", system-ui, sans-serif; direction: rtl; text-align: right;
`;

interface ComparisonRow {
  store: string;
  regionName?: string;
  flag?: string;
  priceILS: number;
  url?: string;
}

interface Comparison {
  matchedTitle: string;
  rows: ComparisonRow[];
  pagePriceILS?: number;
  savingILS?: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = css;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dismissedThisSession(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* storage blocked; the card simply returns on the next navigation */
  }
}

const shekels = (n: number) =>
  `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Only http(s) may reach an href.
 *
 * Offer URLs come from the adapters, and several of those adapters build theirs
 * out of scraped markup. Assigning one straight to `href` means a hostile or
 * compromised store page could plant `javascript:…` and have it run — inside a
 * content script, on whatever page the user is standing on. The web app has had
 * this guard (see web/src/url.ts) since imports became shareable; the extension
 * panels did not, and they are the half that runs on other people's sites.
 */
function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * One round trip to the worker. Never hangs.
 *
 * The timeout is generous because the work is real: a comparison is a search
 * fan-out followed by a price fan-out, and the Israeli shops this tool exists
 * for are held to a gap we are not going to remove to make a panel feel snappy.
 */
function ask<T>(message: Record<string, unknown>, timeoutMs = 90_000): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: T | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      chrome.runtime.sendMessage(message, (reply) => {
        clearTimeout(timer);
        done(chrome.runtime.lastError ? null : ((reply ?? null) as T | null));
      });
    } catch {
      clearTimeout(timer);
      done(null);
    }
  });
}

/** A row: where, how much, and a way to get there. */
function rowNode(row: ComparisonRow, best: boolean): HTMLElement {
  const line = el(
    'div',
    `display:flex;align-items:baseline;gap:7px;padding:5px 0;border-block-start:1px solid #1a2230;`
  );
  const where = el('span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
  where.textContent = row.flag ? `${row.flag} ${row.store}` : row.store;
  if (row.regionName) where.title = row.regionName;

  const price = el(
    'span',
    `font-family:ui-monospace,monospace;direction:ltr;color:${best ? '#4ade80' : '#e6edf3'};`,
    shekels(row.priceILS)
  );

  line.append(where, price);
  const href = safeHref(row.url);
  if (href) {
    const go = el('a', 'color:#ffcc55;text-decoration:none;font-size:12px;', '↗');
    go.href = href;
    go.target = '_blank';
    go.rel = 'noopener noreferrer';
    go.title = 'פתיחת ההצעה בלשונית חדשה';
    line.append(go);
  }
  return line;
}

/**
 * `href` exists so the panel can be exercised outside a real storefront — the
 * one thing that otherwise could only be checked by installing the extension
 * and visiting a shop. Content scripts always call it with no argument.
 */
export function mountStorePanel(href?: string): void {
  if (document.getElementById(PANEL_ID)) return;
  if (dismissedThisSession()) return;

  const page = href ? readStorePage(href) : readStorePage();
  // No game identified means no card. Guessing at what a page is selling, and
  // then comparing prices for the wrong thing, is worse than staying quiet.
  if (!page) return;

  const panel = el('div', PANEL_CSS);
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'VGPT.IL');

  const head = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:6px;');
  head.append(
    el('span', 'font-weight:700;color:#ffcc55;letter-spacing:.02em;', 'VGPT.IL'),
    el('span', 'flex:1;')
  );
  const close = el(
    'button',
    'background:none;border:0;color:#9099a8;cursor:pointer;font-size:15px;line-height:1;padding:2px 4px;',
    '✕'
  );
  close.title = 'סגירה (עד סוף הגלישה)';
  close.addEventListener('click', () => {
    rememberDismissed();
    panel.remove();
  });
  head.append(close);

  // What we think this page is about, stated before anything is compared — a
  // wrong match should be visible at a glance, not discovered in the results.
  const name = el(
    'div',
    'font-weight:600;margin-bottom:2px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;',
    page.title
  );
  const sub = el('div', 'color:#9099a8;font-size:11px;margin-bottom:9px;', page.storeName);

  const body = el('div', '');
  const note = el('div', 'margin-top:8px;color:#9099a8;font-size:10.5px;line-height:1.5;');

  const BUTTON_CSS = `
    width:100%;padding:8px 0;border:0;border-radius:8px;cursor:pointer;
    background:#ffcc55;color:#0d1117;font:600 13px/1 "Segoe UI",system-ui,sans-serif;
  `;
  const button = el('button', BUTTON_CSS, 'השוו מחירים בכל החנויות');
  note.textContent = 'ההשוואה רצה רק כשלוחצים. הכלי לא סורק את העמוד הזה ולא פונה לחנויות מעצמו.';

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.style.opacity = '0.75';
    button.textContent = 'בודק בכל החנויות…';
    note.textContent = 'החנויות הישראליות נבדקות בקצב מכובד, אז זה לוקח כמה שניות.';

    const result = await ask<{ ok: boolean; comparison: Comparison | null }>({
      __vgpt: 'compare-page',
      page: { title: page.title, store: page.store, price: page.price, currency: page.currency },
    });

    button.remove();
    render(result?.ok ? result.comparison : null, page, body, note);
  });

  panel.append(head, name, sub, body, button, note);
  document.body.append(panel);
}

/** The answer, or an honest account of why there isn't one. */
function render(
  comparison: Comparison | null,
  page: StorePage,
  body: HTMLElement,
  note: HTMLElement
): void {
  if (!comparison || comparison.rows.length === 0) {
    body.append(
      el(
        'div',
        'color:#9099a8;font-size:12px;line-height:1.6;',
        comparison
          ? 'לא מצאנו את המשחק הזה בחנויות אחרות שאנחנו בודקים.'
          : 'לא הצלחנו להשלים את ההשוואה כרגע. אפשר לנסות שוב מהכלי עצמו.'
      )
    );
    note.textContent = '';
    return;
  }

  // Named, so a wrong match is caught by the person rather than trusted.
  const matched = el(
    'div',
    'color:#9099a8;font-size:10.5px;margin-bottom:4px;',
    `לפי החיפוש: ${comparison.matchedTitle}`
  );
  body.append(matched);

  comparison.rows.forEach((row, i) => body.append(rowNode(row, i === 0)));

  if (comparison.savingILS !== undefined && comparison.savingILS > 0) {
    const saving = el(
      'div',
      'margin-top:9px;padding:7px 9px;border-radius:8px;background:rgba(74,222,128,.12);border:1px solid rgba(74,222,128,.4);font-size:12px;color:#4ade80;',
      `זול ב־${shekels(comparison.savingILS)} מהמחיר בעמוד הזה`
    );
    body.append(saving);
  } else if (comparison.pagePriceILS !== undefined) {
    // Saying so is the honest half of the feature. A tool that only speaks up
    // when it has found you a saving is an advert.
    body.append(
      el(
        'div',
        'margin-top:9px;font-size:11.5px;color:#9099a8;',
        `המחיר בעמוד הזה (${shekels(comparison.pagePriceILS)}) הוא הזול ביותר שמצאנו.`
      )
    );
  }

  note.textContent =
    page.price === undefined
      ? 'לא הצלחנו לקרוא את המחיר בעמוד הזה, ולכן אין השוואה ישירה אליו. מחירים באזורים אחרים דורשים חשבון באותו אזור.'
      : 'מחירים באזורים אחרים דורשים חשבון באותו אזור. המרה לשקלים לפי שער יציג.';
}
