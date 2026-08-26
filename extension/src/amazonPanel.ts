import { readListing, type AmazonListing } from './amazon.ts';

/**
 * The small card offering to track the listing you are looking at.
 *
 * Everything about its restraint is deliberate. It appears only when a price was
 * actually read, it can be dismissed for the session, and it never covers the
 * page's own controls — an extension that plants a panel over what you came to
 * read is one people uninstall. It also carries no Amazon mark of any kind: the
 * card is in this tool's own colours and says this tool's name, because putting
 * someone else's logo on your UI implies a relationship you do not have.
 *
 * Styles are inlined rather than injected as a stylesheet: this element lives
 * inside a page whose CSS we do not control and must not disturb, and a shadow
 * root would still leave the host page's `!important` rules reaching the host
 * element itself. Every declaration here is scoped to elements we created.
 */

const PANEL_ID = 'vgpt-amazon-panel';
const DISMISS_KEY = 'vgpt-amazon-dismissed';

const PANEL_CSS = `
  position: fixed; inset-block-end: 18px; inset-inline-end: 18px; z-index: 2147483000;
  width: 268px; padding: 13px 14px 12px; box-sizing: border-box;
  background: #0d1117; color: #e6edf3; border: 1px solid #222c3a; border-radius: 12px;
  box-shadow: 0 14px 38px rgba(0,0,0,.45);
  font: 13px/1.5 "Segoe UI", system-ui, sans-serif; direction: rtl; text-align: right;
`;

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
    /* a page with storage blocked simply gets the card again next navigation */
  }
}

/** Ask the worker to track it. Resolves to a human-readable outcome. */
function track(listing: AmazonListing): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (msg: string) => {
      if (!settled) {
        settled = true;
        resolve(msg);
      }
    };
    // A worker that is asleep takes a moment; one that is broken must not leave
    // the button saying "saving…" for ever.
    const timer = setTimeout(() => done('לא הצלחנו לשמור — נסו שוב'), 15000);
    try {
      chrome.runtime.sendMessage({ __vgpt: 'amazon-track', listing }, (reply) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) return done('לא הצלחנו לשמור — נסו שוב');
        done(reply?.ok ? 'נוסף למעקב ✓' : (reply?.error ?? 'לא הצלחנו לשמור'));
      });
    } catch {
      clearTimeout(timer);
      done('לא הצלחנו לשמור — נסו שוב');
    }
  });
}

export function mountAmazonPanel(): void {
  if (document.getElementById(PANEL_ID)) return;
  if (dismissedThisSession()) return;

  const listing = readListing();
  // No price read means no card. Guessing that a page is a product, or showing
  // an empty offer to track "something", is worse than staying out of the way.
  if (!listing) return;

  const panel = el('div', PANEL_CSS);
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'complementary');
  panel.setAttribute('aria-label', 'VGPT.IL');

  const head = el('div', 'display:flex;align-items:center;gap:8px;margin-bottom:8px;');
  head.append(
    el('span', 'font-weight:700;color:#ffcc55;letter-spacing:.02em;', 'VGPT.IL'),
    el('span', 'flex:1;')
  );

  const close = el('button', `
    background:none;border:0;color:#9099a8;cursor:pointer;font-size:15px;line-height:1;padding:2px 4px;
  `, '✕');
  close.title = 'סגירה (עד סוף הגלישה)';
  close.addEventListener('click', () => {
    rememberDismissed();
    panel.remove();
  });
  head.append(close);

  const name = el(
    'div',
    'font-weight:600;margin-bottom:3px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;',
    listing.title
  );
  const price = el(
    'div',
    'font-family:ui-monospace,monospace;font-size:16px;color:#ffcc55;margin-bottom:9px;direction:ltr;text-align:right;',
    `${listing.price.toLocaleString()} ${listing.currency}`
  );

  const button = el('button', `
    width:100%;padding:8px 0;border:0;border-radius:8px;cursor:pointer;
    background:#ffcc55;color:#0d1117;font:600 13px/1 "Segoe UI",system-ui,sans-serif;
  `, 'עקבו אחרי המחיר הזה');

  const note = el(
    'div',
    'margin-top:8px;color:#9099a8;font-size:11px;line-height:1.5;',
    'המחיר נקרא מהעמוד הזה בלבד ונשמר אצלכם במחשב. הוא יתעדכן בפעם הבאה שתפתחו את העמוד — הכלי לא סורק את אמזון.'
  );

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.style.opacity = '0.75';
    button.textContent = 'שומר…';
    const outcome = await track(listing);
    button.textContent = outcome;
    button.style.opacity = '1';
  });

  panel.append(head, name, price, button, note);
  document.body.append(panel);
}
