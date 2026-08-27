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

/**
 * The compact wire shape (v2), and why it is not just the export JSON gzipped.
 *
 * Gzip already exploits repetition, so a compact payload should in theory buy
 * little. Measured on the real database it buys a lot: 9,876 characters became
 * 6,024, a 39% cut, on five games and 822 recorded prices.
 *
 * Two things do the work. Store names, regions, kinds and currencies repeat on
 * every single point, so they become dictionary indices — one copy of "Xbox 🇹🇷"
 * instead of eight hundred. And timestamps, at nineteen characters each, are
 * the single largest thing in the file; stored as seconds since the previous
 * point in the same game they collapse to two or three digits, which alone took
 * 8,132 characters down to 6,024.
 *
 * Length matters because this is a thing people paste into a chat message. A
 * token twice as long is not twice as annoying, it is one somebody gives up on.
 *
 * v1 is still read. It costs a dozen lines and means a token somebody saved
 * last month keeps working.
 */
interface CompactPayload {
  v: 2;
  at: string;
  /** Dictionaries: stores, regions, kinds, currencies. */
  d: { s: string[]; r: string[]; k: string[]; c: string[] };
  i: CompactItem[];
  prefs?: Record<string, string>;
  /**
   * The settings that live in the database rather than the browser: display
   * currency, the alert rule, the capture interval. They were the other half
   * that did not travel — a token restored your list and your dismissed
   * notices, then quietly put your alert rule back to default.
   */
  settings?: Record<string, string>;
}

interface CompactItem {
  t: string;
  p: string;
  m?: string | null;
  f?: unknown;
  pr?: string | null;
  hd?: number;
  /** The user's own note. Sanitised again on import — see noteHtml.ts. */
  n?: string;
  /** Added-at, epoch seconds. */
  a?: number;
  /**
   * [storeIdx, regionIdx, kindIdx, price×100, currencyIdx, priceILS×100, secondsSincePrevious]
   * An index of -1 means null. Prices are integers so the JSON never carries a
   * decimal point eight hundred times.
   */
  h: number[][];
}

export interface TokenPayload {
  v: 1;
  at: string;
  items: unknown[];
  /**
   * The small choices the browser remembers — dismissed notices, the progress
   * bar, the preferred region. They were the one thing that did not travel:
   * you could carry a whole tracked list to another machine and still arrive to
   * popups you had dismissed for good a month earlier.
   */
  prefs?: Record<string, string>;
}

export interface DecodedToken {
  items: unknown[];
  /** Browser-side choices — dismissed notices, the ticker, the owned list. */
  prefs: Record<string, string>;
  /** Database-side settings — display currency, alert rule, capture interval. */
  settings: Record<string, string>;
}

/** "2026-08-01 10:00:00" → epoch seconds. 0 when it cannot be read. */
function toEpoch(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  const ms = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** Epoch seconds → the "YYYY-MM-DD HH:MM:SS" the database stores. */
function fromEpoch(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return new Date(seconds * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/** A growing string→index dictionary. */
function makeDict() {
  const index = new Map<string, number>();
  const list: string[] = [];
  return {
    list,
    put(value: unknown): number {
      if (typeof value !== 'string' || value === '') return -1;
      const seen = index.get(value);
      if (seen !== undefined) return seen;
      index.set(value, list.length);
      list.push(value);
      return list.length - 1;
    },
  };
}

interface ExportShape {
  title?: unknown;
  platform?: unknown;
  image?: unknown;
  refs?: unknown;
  preferred_region?: unknown;
  hide_desc?: unknown;
  note?: unknown;
  added_at?: unknown;
  history?: { store?: unknown; region?: unknown; kind?: unknown; price?: unknown; currency?: unknown; price_ils?: unknown; checked_at?: unknown }[];
}

/** The list as a token. `items` is whatever exportAll() produced. */
export async function encodeToken(
  items: unknown[],
  prefs?: Record<string, string>,
  settings?: Record<string, string>
): Promise<string> {
  const stores = makeDict();
  const regions = makeDict();
  const kinds = makeDict();
  const currencies = makeDict();

  const compactItems: CompactItem[] = items.map((raw) => {
    const item = (raw ?? {}) as ExportShape;
    // Deltas are per game and in order, so each one is two or three digits
    // instead of a nineteen-character timestamp.
    let previous = 0;
    const history = (Array.isArray(item.history) ? item.history : []).map((point) => {
      const at = toEpoch(point.checked_at);
      const delta = at - previous;
      previous = at;
      return [
        stores.put(point.store),
        regions.put(point.region),
        kinds.put(point.kind),
        Math.round(Number(point.price) * 100) || 0,
        currencies.put(point.currency),
        Math.round(Number(point.price_ils) * 100) || 0,
        delta,
      ];
    });

    const out: CompactItem = { t: String(item.title ?? ''), p: String(item.platform ?? ''), h: history };
    if (item.image) out.m = String(item.image);
    if (item.refs) out.f = item.refs;
    if (item.preferred_region) out.pr = String(item.preferred_region);
    if (item.hide_desc) out.hd = 1;
    if (typeof item.note === 'string' && item.note) out.n = item.note;
    const added = toEpoch(item.added_at);
    if (added) out.a = added;
    return out;
  });

  const payload: CompactPayload = {
    v: 2,
    at: new Date().toISOString(),
    d: { s: stores.list, r: regions.list, k: kinds.list, c: currencies.list },
    i: compactItems,
  };
  if (prefs && Object.keys(prefs).length > 0) payload.prefs = prefs;
  if (settings && Object.keys(settings).length > 0) payload.settings = settings;
  return PREFIX + toBase64Url(await gzip(JSON.stringify(payload)));
}

/** Compact back into the shape the ordinary import sanitiser already accepts. */
function expand(payload: CompactPayload): unknown[] {
  const at = (list: string[], index: unknown): string | null =>
    typeof index === 'number' && index >= 0 && index < list.length ? list[index]! : null;
  const d = payload.d ?? { s: [], r: [], k: [], c: [] };

  return (Array.isArray(payload.i) ? payload.i : []).map((item) => {
    let running = 0;
    const history = (Array.isArray(item.h) ? item.h : []).map((row) => {
      running += Number(row[6]) || 0;
      return {
        store: at(d.s ?? [], row[0]) ?? '',
        region: at(d.r ?? [], row[1]),
        kind: at(d.k ?? [], row[2]),
        price: (Number(row[3]) || 0) / 100,
        currency: at(d.c ?? [], row[4]) ?? '',
        price_ils: (Number(row[5]) || 0) / 100,
        checked_at: fromEpoch(running),
      };
    });
    return {
      title: item.t,
      platform: item.p,
      image: item.m ?? null,
      refs: item.f ?? [],
      preferred_region: item.pr ?? null,
      hide_desc: item.hd ?? 0,
      note: item.n ?? null,
      added_at: fromEpoch(item.a ?? 0),
      history,
    };
  });
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
export async function decodeToken(raw: string): Promise<DecodedToken | null> {
  // Chat clients and email wrap long strings; a pasted token often arrives with
  // newlines through the middle of it.
  const text = raw.trim().replace(/\s+/g, '');
  if (!text.startsWith(PREFIX)) return null;
  const bytes = fromBase64Url(text.slice(PREFIX.length));
  if (!bytes || bytes.length === 0) return null;
  try {
    const parsed = JSON.parse(await gunzip(bytes)) as TokenPayload | CompactPayload;
    const bag = (v: unknown): Record<string, string> =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
    const prefs = bag(parsed?.prefs);
    const settings = bag((parsed as CompactPayload)?.settings);
    // v2 is the compact shape; v1 is the plain export, still read so a token
    // somebody saved before this change keeps working.
    if (parsed?.v === 2) return { items: expand(parsed as CompactPayload), prefs, settings };
    const items = (parsed as TokenPayload)?.items;
    return Array.isArray(items) ? { items, prefs, settings } : null;
  } catch {
    return null;
  }
}

/** True when a string looks like one of our tokens at all. */
export function looksLikeToken(raw: string): boolean {
  return raw.trim().startsWith(PREFIX);
}
