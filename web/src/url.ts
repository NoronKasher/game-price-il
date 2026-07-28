/**
 * Only let http(s) URLs reach an href or img src. Tracking data can be imported
 * from other people's shared files, and React does NOT block a "javascript:…"
 * href on its own — so an unsanitised link would execute script on click. The
 * server already rejects such URLs, but this is the cheap last line of defence.
 */
export function safeUrl(u: string | null | undefined): string | undefined {
  if (!u) return undefined;
  try {
    const p = new URL(u, window.location.origin);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : undefined;
  } catch {
    return undefined;
  }
}
