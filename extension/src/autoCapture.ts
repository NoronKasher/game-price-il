import {
  ready,
  flush,
  listWishlist,
  lastCheckedAt,
  recordOffers,
  getCaptureDaysGlobal,
  type WishlistRow,
} from './db.browser.ts';
import { isCaptureDue } from '../../server/src/capture.ts';
import { evaluateAlerts } from '../../server/src/notify.ts';
import { offersFor } from '../../server/src/fanout.ts';
import { refreshBadge } from './badge.ts';
import { remindAboutStaleRows } from './staleReminder.ts';
import type { SourceAdapter } from '../../server/src/adapters/types.ts';
import type { Platform } from '../../server/src/search.ts';
import type { SourceRef } from '../../server/src/fanout.ts';

/**
 * The tracked list re-pricing itself, without anyone opening the app.
 *
 * This was missing outright. The manifest asked for the `alarms` permission and
 * nothing ever created an alarm, so the extension only re-priced a game when a
 * person happened to open it — which means the price history had holes exactly
 * where nobody was looking, and a sale alert could not fire at all unless the
 * user was already looking at the price it was meant to tell them about. The
 * feature the whole tracking list exists for was, in the extension, decorative.
 *
 * WHAT AN ALARM CAN AND CANNOT DO. `chrome.alarms` fire only while the browser
 * is running, and one missed while it was shut fires shortly after it starts
 * again. At a weekly interval that is a small loss: a check due on Tuesday
 * happens when the browser next opens rather than at the stroke of the hour, and
 * a week's price history does not care. It is still a real difference from the
 * desktop build, which is running whether or not anything is open — and it is
 * the honest reason the desktop build exists at all.
 *
 * The schedule is deliberately identical to the server's: look every six hours,
 * act only on games past their own interval (default seven days). The rule that
 * decides is shared code (isCaptureDue), not a second copy that could drift.
 */

const ALARM = 'vgpt-auto-capture';
/** How often to LOOK. What actually gets re-priced is decided by each game's interval. */
const CHECK_MINUTES = 6 * 60;
/** First look shortly after install, so a new tracked list does not wait six hours. */
const FIRST_CHECK_MINUTES = 2;
/** Gentle spacing between games, matching the server's GAME_GAP_MS. */
const GAME_GAP_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const refsOf = (row: WishlistRow): SourceRef[] => JSON.parse(row.refs) as SourceRef[];

/**
 * Keep the worker alive for the length of the run.
 *
 * MV3 stops a service worker after ~30 seconds of inactivity, and a chain of
 * `fetch` calls does not count as activity — so a capture across sixteen stores,
 * paced at 2.5 seconds a host, would be killed a few requests in and leave the
 * history half-written. Calling an extension API resets that idle timer, which
 * is the mechanism the platform gives for work that legitimately takes minutes.
 *
 * Every request this makes is still spaced and budgeted by politeFetch; keeping
 * the worker awake changes how long we may work, never how hard we may ask.
 */
function keepAwake(): () => void {
  const timer = setInterval(() => {
    // The cheapest extension call there is. Its only job is to be a call.
    void chrome.runtime.getPlatformInfo();
  }, 20_000);
  return () => clearInterval(timer);
}

let running = false;

/**
 * Re-price every tracked game that is due. One game failing must not abandon the
 * rest of the list — a store that is down should cost one point, not a week.
 */
export async function runAutoCapture(sources: SourceAdapter[]): Promise<{ checked: number; due: number }> {
  if (running) return { checked: 0, due: 0 };
  running = true;
  const stopKeepingAwake = keepAwake();
  try {
    await ready();
    const items = listWishlist();
    if (items.length === 0) return { checked: 0, due: 0 };

    const globalDays = getCaptureDaysGlobal();
    const due = items.filter((row) => isCaptureDue(lastCheckedAt(row.id), row.capture_days, globalDays));
    if (due.length === 0) {
      // Nothing to fetch does not mean nothing to say: a list made only of
      // page-read rows never has anything due here, and that is exactly the list
      // whose owner needs reminding.
      await remindAboutStaleRows();
      return { checked: 0, due: 0 };
    }

    console.log(`auto-capture: ${due.length}/${items.length} tracked game(s) due…`);
    let checked = 0;
    for (let i = 0; i < due.length; i++) {
      const row = due[i]!;
      try {
        const { offers } = await offersFor(sources, refsOf(row), row.platform as Platform);
        // An empty scrape is an outage, not a data point: recording it would put
        // a phantom "unavailable" notch in the history and could fire an alert
        // about a price that was never quoted.
        if (offers.length > 0) {
          recordOffers(
            row.id,
            offers.map((o) => ({
              store: o.store,
              region: o.region ?? null,
              kind: o.kind ?? null,
              price: o.price,
              currency: o.currency,
              priceILS: o.priceILS,
            }))
          );
          // Evaluated on the rows just recorded, so a notification can never
          // describe a price the history does not hold.
          await evaluateAlerts(row);
          checked++;
        }
      } catch (err) {
        console.warn(`auto-capture: "${row.title}" failed —`, err instanceof Error ? err.message : err);
      }
      if (i < due.length - 1) await sleep(GAME_GAP_MS);
    }
    await flush();
    // Rows nothing can re-check on its own get a reminder in the same bell,
    // because the alternative — visiting the shop unattended — is the thing
    // amazon.com/robots.txt names and refuses. See staleReminder.ts.
    await remindAboutStaleRows();
    // Anything the alerts raised happened with nobody watching; put it on the
    // icon so it is visible without opening the app.
    refreshBadge();
    console.log(`auto-capture: recorded ${checked}/${due.length} due game(s)`);
    return { checked, due: due.length };
  } finally {
    stopKeepingAwake();
    running = false;
  }
}

/**
 * Register the alarm and its handler. Called at module scope, on every wake-up.
 *
 * The `get` before the `create` is load-bearing. `chrome.alarms.create` with the
 * same name REPLACES the existing alarm and restarts its period from now — and
 * this module is evaluated every time the service worker restarts, which for a
 * busy browser can be many times an hour. Creating unconditionally would push
 * the next firing six hours into the future on each restart, so an alarm set to
 * run every six hours would, in practice, never run at all.
 */
export function startAutoCapture(sources: SourceAdapter[]): void {
  if (!chrome.alarms) return;

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void runAutoCapture(sources);
  });

  chrome.alarms.get(ALARM, (existing) => {
    if (existing) return;
    chrome.alarms.create(ALARM, {
      delayInMinutes: FIRST_CHECK_MINUTES,
      periodInMinutes: CHECK_MINUTES,
    });
  });
}
