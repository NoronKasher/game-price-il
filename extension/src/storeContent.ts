import { mountStorePanel } from './storePanel.ts';

/**
 * Entry point for the store-page content script.
 *
 * Every one of these storefronts is a single-page app: moving from one game to
 * the next rewrites the DOM without a load event, so mounting once on script
 * start would leave the previous game's name on the next page — and a
 * comparison run from a stale title is worse than none.
 *
 * The delay is not cosmetic either. These pages render a shell first and fill
 * the title and price in afterwards, so an immediate read finds an empty
 * heading and the panel decides, correctly, that this is not a product page.
 */

const PANEL_ID = 'vgpt-store-panel';
let lastUrl = location.href;

const remount = () => {
  document.getElementById(PANEL_ID)?.remove();
  setTimeout(() => mountStorePanel(), 900);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', remount, { once: true });
} else {
  remount();
}

new MutationObserver(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  remount();
}).observe(document, { subtree: true, childList: true });
