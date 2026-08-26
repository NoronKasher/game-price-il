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

interface WorkerReply {
  ok?: boolean;
  tracked?: boolean;
  recorded?: boolean;
  error?: string;
}

/** One round trip to the worker. Never hangs: a dead worker resolves as a failure. */
function ask(message: Record<string, unknown>): Promise<WorkerReply> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (reply: WorkerReply) => {
      if (!settled) {
        settled = true;
        resolve(reply);
      }
    };
    // A sleeping worker takes a moment; a broken one must not leave a button
    // saying "saving…" for ever.
    const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), 15000);
    try {
      chrome.runtime.sendMessage(message, (reply) => {
        clearTimeout(timer);
        done(chrome.runtime.lastError ? { ok: false, error: 'disconnected' } : (reply ?? {}));
      });
    } catch {
      clearTimeout(timer);
      done({ ok: false, error: 'failed' });
    }
  });
}

export async function mountAmazonPanel(): Promise<void> {
  if (document.getElementById(PANEL_ID)) return;
  if (dismissedThisSession()) return;

  const listing = readListing();
  // No price read means no card. Guessing that a page is a product, or showing
  // an empty offer to track "something", is worse than staying out of the way.
  if (!listing) return;

  // Tell the worker we are looking at this listing BEFORE drawing anything. If
  // it is already tracked, that visit is itself the price check — the user asked
  // for this price to be followed, and making them press a button to save a
  // number they are already looking at would throw readings away for nothing.
  const seen = await ask({ __vgpt: 'amazon-seen', listing });
  let tracked = seen.tracked === true;

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
  // The delivered cost when Amazon printed the parts, the item price when it did
  // not — and the line underneath says which of the two this is.
  const extras = (listing.importFees ?? 0) + (listing.shipping ?? 0);
  const stated = listing.importFees !== undefined || listing.shipping !== undefined;
  const total = listing.price + extras;

  const price = el(
    'div',
    'font-family:ui-monospace,monospace;font-size:16px;color:#ffcc55;direction:ltr;text-align:right;',
    `${total.toLocaleString()} ${listing.currency}`
  );
  const breakdown = el(
    'div',
    'color:#9099a8;font-size:11px;margin-bottom:9px;direction:ltr;text-align:right;',
    stated
      ? `${listing.price.toLocaleString()} + ${extras.toLocaleString()} משלוח ומיסים`
      : 'מחיר הפריט בלבד — הדף לא ציין משלוח ומיסים'
  );

  const TRACK_CSS = `
    width:100%;padding:8px 0;border:0;border-radius:8px;cursor:pointer;
    background:#ffcc55;color:#0d1117;font:600 13px/1 "Segoe UI",system-ui,sans-serif;
  `;
  const UNTRACK_CSS = `
    width:100%;padding:8px 0;border:1px solid #2f3a4d;border-radius:8px;cursor:pointer;
    background:none;color:#9099a8;font:600 13px/1 "Segoe UI",system-ui,sans-serif;
  `;

  const button = el('button', TRACK_CSS);
  const note = el('div', 'margin-top:8px;color:#9099a8;font-size:11px;line-height:1.5;');

  /**
   * Reflects what is actually stored, so reopening the page cannot offer to add
   * a listing that is already tracked — which it did, producing a duplicate row
   * on every reload.
   */
  const paint = () => {
    if (tracked) {
      button.style.cssText = UNTRACK_CSS;
      button.textContent = 'הסירו מהמעקב';
      note.textContent = seen.recorded
        ? 'הפריט במעקב, והמחיר שבעמוד הזה נרשם עכשיו. כל פתיחה של העמוד מעדכנת אותו — הכלי לא סורק את אמזון בעצמו.'
        : 'הפריט כבר במעקב. כל פתיחה של העמוד מעדכנת את המחיר — הכלי לא סורק את אמזון בעצמו.';
    } else {
      button.style.cssText = TRACK_CSS;
      button.textContent = 'עקבו אחרי המחיר הזה';
      note.textContent =
        'המחיר נקרא מהעמוד הזה בלבד ונשמר אצלכם במחשב. הוא יתעדכן בכל פעם שתפתחו את העמוד — הכלי לא סורק את אמזון.';
    }
  };
  paint();

  button.addEventListener('click', async () => {
    const wasTracked = tracked;
    button.disabled = true;
    button.style.opacity = '0.75';
    button.textContent = wasTracked ? 'מסיר…' : 'שומר…';

    const reply = wasTracked
      ? await ask({ __vgpt: 'amazon-untrack', asin: listing.asin })
      : await ask({ __vgpt: 'amazon-track', listing });

    button.disabled = false;
    button.style.opacity = '1';
    if (reply.ok) {
      tracked = !wasTracked;
      paint();
    } else {
      button.textContent = 'לא הצלחנו — נסו שוב';
    }
  });

  panel.append(head, name, price, breakdown, button, note);
  document.body.append(panel);
}
