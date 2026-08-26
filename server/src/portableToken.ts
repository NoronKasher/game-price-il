/**
 * The tracked list as one string you can paste anywhere.
 *
 * The file export already works and stays. A token is the better shape for the
 * cases the file is bad at: moving between the extension and the desktop app,
 * a phone with no comfortable download-then-upload dance, or sending your list
 * to someone in a chat message. Nothing to save, nothing to find again.
 *
 * IT IS COMPRESSED, NOT ENCRYPTED, AND IT IS NOT A SECRET. Anyone holding the
 * string can read the list back — that is the whole point of a thing you paste.
 * Nothing sensitive lives in it (game titles, prices, timestamps), and it never
 * leaves the machine unless the user hands it to someone.
 *
 * SIZE IS THE REAL DESIGN CONSTRAINT. Measured against a real database: the
 * list and its settings cost about 220 characters per game, and the full price
 * history costs about 1,980. Twenty games with everything is roughly 40,000
 * characters — a wall of text, but one you paste rather than type, and losing
 * the history would defeat the point of a price tracker. So history is included
 * by default and can be left out, and the UI shows the length either way.
 */

const PREFIX = 'VGPT1-';

/**
 * A ceiling on what a token may expand to.
 *
 * Gzip expands enormously from very little: a few hundred bytes of crafted
 * input can decompress to gigabytes, which is a way to take down whatever is
 * decoding it. This is not a theoretical concern for something people paste
 * from a chat message. Ten megabytes is far more than the largest real list —
 * a 300-game history is under two — and small enough to be harmless.
 */
const MAX_DECODED_BYTES = 10 * 1024 * 1024;

/** URL-safe base64: a token ends up in chat messages and address bars. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // In chunks: String.fromCharCode(...arr) throws on a large enough array, and
  // "large enough" here is an ordinary tracked list.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  if (buffer.byteLength > MAX_DECODED_BYTES) throw new Error('token too large');
  return new TextDecoder().decode(buffer);
}

export interface TokenPayload {
  v: 1;
  at: string;
  items: unknown[];
}

/** The list as a token. `items` is whatever exportAll() produced. */
export async function encodeToken(items: unknown[]): Promise<string> {
  const payload: TokenPayload = { v: 1, at: new Date().toISOString(), items };
  return PREFIX + toBase64Url(await gzip(JSON.stringify(payload)));
}

/**
 * A token back into items, or null when the string is not one of ours.
 *
 * Every failure returns null rather than throwing: this input is pasted by
 * hand, so a truncated copy, a stray space or somebody's shopping list are all
 * expected, and none of them is an error worth a stack trace. What comes out
 * still goes through the ordinary import sanitiser — a token is untrusted input
 * exactly like a file is.
 */
export async function decodeToken(raw: string): Promise<unknown[] | null> {
  // Chat clients and email wrap long strings; a pasted token often arrives with
  // newlines through the middle of it.
  const text = raw.trim().replace(/\s+/g, '');
  if (!text.startsWith(PREFIX)) return null;
  const bytes = fromBase64Url(text.slice(PREFIX.length));
  if (!bytes || bytes.length === 0) return null;
  try {
    const parsed = JSON.parse(await gunzip(bytes)) as TokenPayload;
    return Array.isArray(parsed?.items) ? parsed.items : null;
  } catch {
    return null;
  }
}

/** True when a string looks like one of our tokens at all. */
export function looksLikeToken(raw: string): boolean {
  return raw.trim().startsWith(PREFIX);
}
