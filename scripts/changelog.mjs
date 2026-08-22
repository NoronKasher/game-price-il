/**
 * Turn changelog.json into the two places release notes are actually read.
 *
 *   node scripts/changelog.mjs
 *
 * 1. desktop/patch-notes.html — a self-contained page the desktop app opens in
 *    its own window. Self-contained matters: it is loaded with loadFile() from
 *    inside the packaged app, where there is no server to fetch anything from
 *    and no network to depend on.
 *
 * 2. extension/WHATS-NEW.md — the text to paste into the browser store listing.
 *    The extension deliberately never shows this to anyone itself: the store
 *    page already carries a changelog, and interrupting somebody's browsing to
 *    repeat it is how an extension earns an uninstall.
 *
 * Generated rather than written twice, so the two can never disagree about what
 * shipped — which is the only failure mode a changelog really has.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const source = JSON.parse(fs.readFileSync(path.join(root, 'changelog.json'), 'utf8'));
const releases = source.releases ?? [];

/** Which audience a change belongs to. 'all' reaches everyone. */
const forAudience = (release, audience) =>
  (release.changes ?? []).filter((c) => c.where === 'all' || c.where === audience);

const esc = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** dd.mm.yyyy — the way a date is written in Hebrew. */
const heDate = (iso) => (iso ?? '').split('-').reverse().join('.');

/* ───────────────────────── the desktop page ───────────────────────── */

function desktopHtml() {
  const sections = releases
    .map((release) => {
      const changes = forAudience(release, 'desktop');
      if (changes.length === 0) return '';
      const items = changes
        .map(
          (c) => `      <li>
        <h3>${esc(c.title)}</h3>
        <p>${esc(c.text)}</p>
      </li>`
        )
        .join('\n');
      return `  <section class="release">
    <header>
      <h2>גרסה ${esc(release.version)}</h2>
      <time>${esc(heDate(release.date))}</time>
    </header>
    ${release.headline ? `<p class="headline">${esc(release.headline)}</p>` : ''}
    <ul>
${items}
    </ul>
  </section>`;
    })
    .filter(Boolean)
    .join('\n');

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>VGPT.IL — מה חדש</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>
  :root { color-scheme: dark; --bg: #0d1117; --panel: #131820; --line: #222c3a; --text: #e6edf3; --muted: #9099a8; --amber: #ffcc55; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 24px 40px; background: var(--bg); color: var(--text);
    font-family: 'Segoe UI', system-ui, sans-serif; line-height: 1.7;
  }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: 0.01em; }
  h1 span { color: var(--amber); }
  .sub { margin: 0 0 26px; color: var(--muted); font-size: 13px; }
  .release { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; margin-bottom: 16px; }
  .release header { display: flex; align-items: baseline; gap: 12px; border-bottom: 1px solid var(--line); padding-bottom: 10px; margin-bottom: 12px; }
  .release h2 { margin: 0; font-size: 16px; color: var(--amber); }
  .release time { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .headline { margin: 0 0 14px; color: var(--text); font-size: 14px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li + li { margin-top: 14px; border-top: 1px solid #1a2230; padding-top: 14px; }
  h3 { margin: 0 0 3px; font-size: 14px; font-weight: 600; }
  p { margin: 0; color: var(--muted); font-size: 13.5px; }
  .empty { color: var(--muted); }
</style>
</head>
<body>
  <h1><span>VGPT.IL</span> — מה חדש</h1>
  <p class="sub">רשימת השינויים של אפליקציית שולחן העבודה.</p>
${sections || '  <p class="empty">אין עדיין רשימת שינויים.</p>'}
</body>
</html>
`;
}

/* ──────────────────── the browser-store listing text ──────────────────── */

function extensionMarkdown() {
  const blocks = releases
    .map((release) => {
      const changes = forAudience(release, 'extension');
      if (changes.length === 0) return '';
      const items = changes.map((c) => `- **${c.title}** — ${c.text}`).join('\n');
      return `## גרסה ${release.version} — ${heDate(release.date)}\n\n${
        release.headline ? `${release.headline}\n\n` : ''
      }${items}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return `# VGPT.IL — מה חדש בתוסף

<!--
  GENERATED FILE — do not edit. Run "npm run changelog" after editing changelog.json.

  This is the text for the browser store's "What's new" field. The extension
  itself never displays it: the store page is where an extension's changelog
  belongs, and interrupting someone's browsing to repeat it is how an extension
  gets uninstalled. The desktop app is the opposite case — it has no store page,
  so it carries its own What's-New window.
-->

${blocks || '_אין עדיין רשימת שינויים._'}
`;
}

/* ──────────────────────────── write them ──────────────────────────── */

const outputs = [
  [path.join(root, 'desktop', 'patch-notes.html'), desktopHtml()],
  [path.join(root, 'extension', 'WHATS-NEW.md'), extensionMarkdown()],
];

for (const [file, content] of outputs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  console.log(`wrote ${path.relative(root, file)} — ${content.length} bytes`);
}

const latest = releases[0];
if (latest) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== latest.version) {
    console.log(
      `\nNOTE: package.json is ${pkg.version} but the newest release note is ${latest.version}.` +
        '\nThe updater compares package.json, so the two should match before you publish.'
    );
  }
}
