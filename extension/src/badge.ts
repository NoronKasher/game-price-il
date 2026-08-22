import { unreadNotificationCount } from './db.browser.ts';

/**
 * Unread sale alerts, on the toolbar icon.
 *
 * The background capture runs precisely when nobody is looking, so an alert it
 * raises lands in a bell inside a tab that is not open. Without something on the
 * icon, "the price you were waiting for dropped" waits for the user to go and
 * check whether they have been told anything — which is the thing the alert was
 * supposed to save them from.
 *
 * `chrome.action.setBadgeText` needs no permission beyond having an action, so
 * this costs the store listing nothing.
 */
export function refreshBadge(): void {
  if (!chrome.action?.setBadgeText) return;
  try {
    const unread = unreadNotificationCount();
    void chrome.action.setBadgeText({ text: unread > 0 ? String(Math.min(unread, 99)) : '' });
    if (unread > 0) {
      void chrome.action.setBadgeBackgroundColor?.({ color: '#ffcc55' });
      // The badge sits on the app's amber, so the text has to be the dark panel
      // colour to be legible rather than the default white on yellow.
      void chrome.action.setBadgeTextColor?.({ color: '#0d1117' });
    }
  } catch {
    // A badge is a courtesy. It must never be the reason a capture run fails.
  }
}
