import { mountAmazonPanel } from './amazonPanel.ts';

/**
 * Entry point for the Amazon content script.
 *
 * Amazon is a single-page-ish app: navigating between products often rewrites
 * the DOM without a load event, so mounting once on script start would show the
 * previous product's price on the next one. The observer re-reads on URL change
 * and gives the page a moment to settle before looking.
 */
let lastUrl = location.href;

const remount = () => {
  document.getElementById('vgpt-amazon-panel')?.remove();
  // Amazon fills the price block in after the shell renders; a single immediate
  // read finds an empty container and shows nothing.
  setTimeout(() => mountAmazonPanel(), 600);
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
