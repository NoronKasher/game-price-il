import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * The stylesheet, checked for the one damage class that passes every other gate.
 *
 * CSS has no compiler. TypeScript would not catch it, the tests did not, the
 * build succeeded, and the page rendered — just wrongly. That is exactly what
 * happened: removing a feature with a regex deleted the third line of a shared
 * selector list,
 *
 *     .card .noart,
 *     .dt-noart,
 *     .absorb-clone .absorb-noart {   ← this line removed
 *
 * which left two selectors dangling into the NEXT rule and silently dropped the
 * whole "no cover art" placeholder. Nothing failed. The placeholder simply
 * stopped existing, and it took a person noticing to find it.
 *
 * So: braces must balance, no selector may dangle, and the rules the app
 * actually depends on must still be there by name.
 */

const CSS = await readFile(new URL('./board.css', import.meta.url), 'utf8');

/** The stylesheet with comments and string literals removed, for counting. */
function stripped(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
}

test('every brace is closed', () => {
  const css = stripped(CSS);
  const open = (css.match(/\{/g) ?? []).length;
  const close = (css.match(/\}/g) ?? []).length;
  assert.equal(open, close, `${open} "{" against ${close} "}"`);
});

test('no selector dangles without a block', () => {
  // A selector list ends every line with a comma until the last, which opens a
  // block. A line ending in a comma whose list never reaches a "{" is the shape
  // the placeholder bug left behind.
  const lines = stripped(CSS).split('\n');
  const dangling = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.endsWith(',')) continue;
    // Walk forward: the list must reach a line containing "{" without first
    // hitting a "}" or a blank line.
    let found = false;
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const next = lines[j].trim();
      if (next === '' || next.startsWith('}')) break;
      if (next.includes('{')) {
        found = true;
        break;
      }
      if (!next.endsWith(',')) break;
    }
    // Inside a block, a comma ends a value list (font stacks, gradients) and is
    // not a selector at all — those lines are indented.
    if (!found && !lines[i].startsWith(' ')) dangling.push(`line ${i + 1}: ${line}`);
  }
  assert.deepEqual(dangling, [], `selectors with no block:\n  ${dangling.join('\n  ')}`);
});

test('the placeholder for games with no cover art is still styled', () => {
  // Several sources send no image at all — Ubisoft never does — so this is not
  // a rare path. Without these rules a bare title sits on flat grey and reads
  // as a broken image rather than a deliberate absence.
  for (const rule of ['.card .noart', '.dt-noart']) {
    assert.ok(CSS.includes(`${rule},`) || CSS.includes(`${rule} {`), `missing: ${rule}`);
  }
  const block = CSS.slice(CSS.indexOf('.card .noart,'), CSS.indexOf('.card .body {'));
  assert.match(block, /radial-gradient/, 'the drawn panel');
  assert.match(block, /repeating-linear-gradient/, 'the shelf lines');
  assert.match(block, /content: "🎮"/, 'the "no picture" mark');
});

test('the classes the components render all have rules', () => {
  // Cheap protection against the other half of the same class of mistake:
  // renaming or deleting a rule while the JSX still asks for it.
  const REQUIRED = [
    '.ticker',
    '.reel',
    '.deal-card',
    '.bundle',
    '.note-box',
    '.note-view',
    '.support-footer',
    '.cur-field',
    '.firstcheck',
    '.dt-included',
    '.pstat-ever',
    '.deals-grid',
  ];
  const missing = REQUIRED.filter((cls) => !CSS.includes(cls));
  assert.deepEqual(missing, [], `classes rendered by components with no CSS: ${missing.join(', ')}`);
});
