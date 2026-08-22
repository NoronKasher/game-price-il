/**
 * Final step of the extension build: put manifest.json beside the bundles.
 *
 * It is copied rather than kept in dist/ so the source of truth stays in version
 * control while dist/ remains disposable.
 */
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const dist = path.join(here, 'dist');

fs.mkdirSync(dist, { recursive: true });
for (const f of ['manifest.json', 'rules.json']) {
  fs.copyFileSync(path.join(here, f), path.join(dist, f));
}

const need = ['manifest.json', 'rules.json', 'background.js', 'index.html'];
const missing = need.filter((f) => !fs.existsSync(path.join(dist, f)));
if (missing.length) {
  console.error(`extension build incomplete — missing: ${missing.join(', ')}`);
  process.exit(1);
}

const size = (f) => Math.round(fs.statSync(path.join(dist, f)).size / 1024);
console.log(`extension ready: ${dist}`);
for (const f of need) console.log(`  ${f} — ${size(f)} KB`);
