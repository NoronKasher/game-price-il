import * as cheerio from 'cheerio';

/**
 * The user's own note about a game, and the whitelist that makes it safe.
 *
 * A note is rich text on purpose — colours, a bold line, an emoji, a picture
 * somebody pasted in. That means storing HTML, and storing HTML that is later
 * rendered means one of two things: a sanitiser, or a stored XSS hole in an app
 * whose whole point is that it holds your data locally and safely.
 *
 * IT IS A WHITELIST, NOT A BLACKLIST, and that distinction is the entire
 * security argument. A blacklist ("strip <script>") is a list of the attacks
 * somebody thought of; every sanitiser ever broken was a blacklist. Here, a tag
 * that is not named is dropped, an attribute that is not named is dropped, and
 * a CSS property that is not named is dropped — so an attack nobody has thought
 * of yet fails by default rather than succeeding by omission.
 *
 * It parses with cheerio rather than matching with regexes. HTML is not a
 * regular language, and the classic bypasses (`<scr<script>ipt>`, an unclosed
 * quote swallowing the next attribute, a NUL byte inside a tag name) all exist
 * because somebody tried anyway. Cheerio is already in both shells for the
 * store adapters, so this costs nothing to bundle.
 *
 * Notes never leave the machine on their own — but they DO travel in the
 * portable token, which people paste to each other. That is exactly why this
 * runs on the way IN as well as the way out.
 */

/** Structure and emphasis. No <script>, <style>, <iframe>, <object>, <form>. */
const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'strike',
  'br',
  'p',
  'div',
  'span',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'h3',
  'h4',
  'a',
  'img',
]);

/** Per-tag attribute whitelist. Everything else — every on*, every data-* — goes. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height']),
};
/** Allowed on any permitted tag. */
const GLOBAL_ATTRS = new Set(['style']);

/**
 * CSS properties a note may set.
 *
 * Appearance only. Nothing positional (`position`, `top`, `z-index`) because a
 * note must not be able to cover the app's own controls, and nothing that takes
 * a URL, because `url(...)` is a request the user did not make.
 */
const ALLOWED_CSS = new Set([
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'text-decoration',
  'text-align',
]);

/**
 * A CSS value with nothing executable or fetchable in it.
 *
 * `url(` covers background images and, historically, javascript: in old
 * engines. `expression(` is IE's script-in-CSS. A backslash can encode either
 * past a naive check, and no legitimate colour or font name needs one.
 */
const SAFE_CSS_VALUE = /^[a-z0-9 ,.%#()'"\-/]+$/i;
const UNSAFE_CSS = /url\s*\(|expression\s*\(|javascript:|@import|\\/i;

/**
 * How big a note may be.
 *
 * Generous, because a pasted image arrives as a data: URL and those are large.
 * Bounded, because a note lives in the database, in the export, and in a token
 * people paste into chat messages — and because "unbounded" is a way to fill
 * somebody's disk.
 */
export const MAX_NOTE_BYTES = 256 * 1024;

/** http(s), or an inline image somebody pasted. Nothing else. */
function safeSrc(value: string): string | null {
  const url = value.trim();
  // A pasted or dragged-in picture arrives as base64. Only real image types,
  // and never svg — an SVG is a document that can carry script.
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function safeHref(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Keep only whitelisted properties, and only with values that fetch nothing. */
function safeStyle(value: string): string | null {
  const kept: string[] = [];
  for (const rule of value.split(';')) {
    const at = rule.indexOf(':');
    if (at === -1) continue;
    const prop = rule.slice(0, at).trim().toLowerCase();
    const val = rule.slice(at + 1).trim();
    if (!ALLOWED_CSS.has(prop) || !val) continue;
    if (UNSAFE_CSS.test(val) || !SAFE_CSS_VALUE.test(val)) continue;
    if (val.length > 120) continue;
    kept.push(`${prop}: ${val}`);
  }
  return kept.length ? kept.join('; ') : null;
}

/**
 * A note, reduced to what is safe to store and render.
 *
 * Returns '' for anything that sanitises to nothing, so "empty" has one
 * representation rather than two.
 */
export function sanitizeNote(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return '';
  // Truncating first bounds the parser's work too: a hostile note should not be
  // able to cost more than a large legitimate one.
  const input = raw.length > MAX_NOTE_BYTES ? raw.slice(0, MAX_NOTE_BYTES) : raw;

  const $ = cheerio.load(input, null, false);

  $('*').each((_, raw) => {
    // Narrowed by shape rather than by `type`, for the reason immediately below.
    const node = raw as { tagName?: unknown; attribs?: Record<string, string> };
    // An ELEMENT is anything with a tag name — deliberately not `type === 'tag'`.
    // domhandler gives <script> the type 'script' and <style> the type 'style',
    // so a `type !== 'tag'` guard skips precisely the two elements that matter
    // most. It did, and `<script>alert(1)</script>` sailed through untouched
    // until a test asked.
    const tag = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '';
    if (!tag) return;
    const el = $(raw);

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrapped rather than deleted, so text inside an unknown tag survives —
      // except for elements whose CONTENT is code or markup, where the text is
      // the danger and must go with the tag.
      if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
        el.remove();
      } else {
        el.replaceWith($.html(el.contents()));
      }
      return;
    }

    const allowed = ALLOWED_ATTRS[tag];
    const attribs = node.attribs ?? {};
    for (const name of Object.keys(attribs)) {
      const key = name.toLowerCase();
      const value = attribs[name] ?? '';

      if (GLOBAL_ATTRS.has(key)) {
        const style = safeStyle(value);
        el.removeAttr(name);
        if (style) el.attr('style', style);
        continue;
      }
      if (!allowed?.has(key)) {
        el.removeAttr(name); // every on*, every data-*, srcset, formaction…
        continue;
      }
      if (key === 'href') {
        const href = safeHref(value);
        el.removeAttr(name);
        if (href) {
          el.attr('href', href);
          // A note's links open away from the app, and never with a handle back
          // to it: window.opener is a way for the opened page to navigate this
          // one somewhere else.
          el.attr('target', '_blank');
          el.attr('rel', 'noopener noreferrer');
        }
        continue;
      }
      if (key === 'src') {
        const src = safeSrc(value);
        el.removeAttr(name);
        if (src) el.attr('src', src);
        else el.remove();
        continue;
      }
      if (key === 'width' || key === 'height') {
        // Numbers only, and bounded: an image sized 100000px is a way to make
        // the page unusable.
        const n = Number(value);
        el.removeAttr(name);
        if (Number.isFinite(n) && n > 0 && n <= 2000) el.attr(key, String(Math.round(n)));
      }
    }
  });

  const html = $.html().trim();
  // A note of nothing but empty tags is an empty note.
  return $.text().trim() === '' && !/<img\b/i.test(html) ? '' : html;
}
