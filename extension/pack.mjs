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

// Chrome writes _metadata/ into an unpacked extension's folder when it loads
// it. It is Chrome's bookkeeping, not ours, and shipping it in a store upload
// is a rejection waiting to happen.
fs.rmSync(path.join(dist, '_metadata'), { recursive: true, force: true });

/**
 * Drop assets from earlier builds.
 *
 * Vite writes content-hashed filenames, and this directory is built with
 * `emptyOutDir: false` — the UI build and the service-worker build each add to
 * it, and neither may wipe it without destroying the other's output. So every
 * rebuild leaves the previous bundle behind under its old hash, and nothing ever
 * removes it. Measured before this existed: 292 KB of real assets and 1,605 KB
 * of orphans across ten dead files, all of it headed for the store upload.
 *
 * index.html is the authority on what is live — it names the exact hashed files
 * this build produced.
 */
function pruneStaleAssets() {
  const assets = path.join(dist, 'assets');
  const indexHtml = path.join(dist, 'index.html');
  if (!fs.existsSync(assets) || !fs.existsSync(indexHtml)) return;

  const html = fs.readFileSync(indexHtml, 'utf8');
  const live = new Set([...html.matchAll(/(?:src|href)="[^"]*assets\/([^"]+)"/g)].map((m) => m[1]));

  let removed = 0;
  let freed = 0;
  for (const file of fs.readdirSync(assets)) {
    if (live.has(file)) continue;
    const full = path.join(assets, file);
    freed += fs.statSync(full).size;
    fs.rmSync(full, { force: true });
    removed++;
  }
  if (removed > 0) {
    console.log(`pruned ${removed} stale asset(s) from earlier builds — ${Math.round(freed / 1024)} KB`);
  }
}
pruneStaleAssets();
for (const f of ['manifest.json', 'rules.json']) {
  fs.copyFileSync(path.join(here, f), path.join(dist, f));
}

const need = ['manifest.json', 'rules.json', 'background.js', 'bridge.js', 'index.html'];
const missing = need.filter((f) => !fs.existsSync(path.join(dist, f)));
if (missing.length) {
  console.error(`extension build incomplete — missing: ${missing.join(', ')}`);
  process.exit(1);
}

const size = (f) => Math.round(fs.statSync(path.join(dist, f)).size / 1024);
console.log(`extension ready: ${dist}`);
for (const f of need) console.log(`  ${f} — ${size(f)} KB`);
