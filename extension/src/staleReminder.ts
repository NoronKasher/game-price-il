import { ready, listWishlist, lastCheckedAt, addNotification, flush } from './db.browser.ts';
import { isCaptureDue } from '../../server/src/capture.ts';
import { getCaptureDaysGlobal } from './db.browser.ts';
import { refreshBadge } from './badge.ts';
import { AMAZON_SOURCE } from './amazonTrack.ts';

/**
 * A reminder for the rows nothing can re-check on its own.
 *
 * Every other source can be asked again on a schedule. A listing read off a page
 * cannot: refreshing it would mean the extension visiting Amazon unattended, and
 * amazon.com/robots.txt names automated shopping agents specifically —
 * GoogleAgent-Shopping, PerplexityBot, Scrapy, ClaudeBot — and refuses them
 * outright. Doing it inside a browser tab would not make it a different act,
 * only an undetectable one, and undetectability is the anonymity this project
 * has declined from the start.
 *
 * So the tool asks the PERSON instead. When a page-read row goes stale it says
 * so in the same bell as everything else, with a link. Opening it is the user
 * browsing, which they were always free to do, and the visit records the price
 * by itself (see recordAmazonVisit). The series still accumulates; the extension
 * simply never goes anywhere on its own.
 *
 * One reminder per row per staleness period, not one per check — the alert log
 * exists to be read, and a nag every six hours is how a bell gets ignored.
 */

/** Sources whose prices only a human visit can refresh. */
const UNREACHABLE_SOURCES = new Set([AMAZON_SOURCE]);
const REMINDED_KEY = 'vgpt_stale_reminded';

interface Reminded {
  [wishlistId: string]: string;
}

async function loadReminded(): Promise<Reminded> {
  try {
    const bag = await chrome.storage.local.get(REMINDED_KEY);
    const raw = bag[REMINDED_KEY];
    return raw && typeof raw === 'object' ? (raw as Reminded) : {};
  } catch {
    return {};
  }
}

async function saveReminded(value: Reminded): Promise<void> {
  try {
    await chrome.storage.local.set({ [REMINDED_KEY]: value });
  } catch {
    /* storage unavailable; the worst case is a repeated reminder */
  }
}

/** The page to open, so the reminder can be acted on rather than merely felt. */
function pageUrlFor(refs: { sourceId: string; sourceGameId: string }[]): string | null {
  const amazon = refs.find((r) => r.sourceId === AMAZON_SOURCE);
  return amazon ? `https://www.amazon.com/dp/${amazon.sourceGameId}` : null;
}

export async function remindAboutStaleRows(): Promise<number> {
  await ready();
  const globalDays = getCaptureDaysGlobal();
  const reminded = await loadReminded();
  let raised = 0;

  for (const row of listWishlist()) {
    let refs: { sourceId: string; sourceGameId: string }[] = [];
    try {
      refs = JSON.parse(row.refs);
    } catch {
      continue;
    }
    // Only rows whose EVERY source is one we cannot reach. A game that also
    // lives on Steam is refreshed by the ordinary capture and needs no nagging.
    if (refs.length === 0 || !refs.every((r) => UNREACHABLE_SOURCES.has(r.sourceId))) continue;

    const last = lastCheckedAt(row.id);
    if (!isCaptureDue(last, row.capture_days, globalDays)) continue;
    // Already asked about this exact staleness — asking again on the next tick
    // is how a bell becomes noise.
    if (last && reminded[row.id] === last) continue;

    const url = pageUrlFor(refs);
    addNotification({
      wishlistId: row.id,
      title: row.title,
      message: url
        ? `לא נבדק מזמן. פתחו את עמוד המוצר כדי לעדכן את המחיר: ${url}`
        : 'לא נבדק מזמן — פתחו את עמוד המוצר כדי לעדכן את המחיר.',
      priceILS: null,
      kind: 'stale',
      platform: row.platform,
      scope: null,
    });
    reminded[row.id] = last ?? 'never';
    raised++;
  }

  if (raised > 0) {
    await saveReminded(reminded);
    await flush();
    refreshBadge();
  }
  return raised;
}
