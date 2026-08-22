/**
 * PlayStation persisted-query hash — the extension's stand-in for psnHash.ts.
 *
 * The server recovers a rotated hash by driving a real browser with Playwright.
 * An extension cannot import Playwright, and does not need it: it already IS a
 * browser, so the eventual recovery here is to watch the store's own request go
 * past. That is a different mechanism rather than a port of this one, so until
 * it exists the extension runs on the built-in (or manually pasted) hash and
 * says so honestly instead of pretending a recovery happened.
 *
 * PSN still works — the hash only rotates occasionally. When it does, searches
 * fail loudly rather than silently returning nothing, because psn.ts raises
 * PsnHashError on the store's "Query not whitelisted" response.
 */

/** No automatic recovery here yet; null means "could not find a fresh hash". */
export async function discoverSearchHashShared(): Promise<string | null> {
  return null;
}

/** Never due: there is nothing to run, and claiming otherwise would just retry. */
export function hashDiscoveryDue(): boolean {
  return false;
}

/** No Playwright engine to probe for in an extension. */
export async function probeBrowser(): Promise<null> {
  return null;
}

/**
 * The rejection bookkeeping the server keeps, kept here too.
 *
 * It costs nothing and it is the half that is NOT specific to Playwright: the
 * desktop build already uses exactly this signal to trigger a recovery with its
 * own Chromium (desktop/psnHash.js), and whatever recovery this extension
 * eventually grows will want the same flag rather than a new one.
 */
let rejectedAt = 0;
let savedAt = 0;

export function noteHashRejected(): void {
  rejectedAt = Date.now();
}
export function noteHashSaved(): void {
  savedAt = Date.now();
}
export function hashNeedsRecovery(): boolean {
  return rejectedAt > 0 && rejectedAt > savedAt;
}
