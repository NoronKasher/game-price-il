/**
 * Package the built extension for distribution.
 *
 * Produces extension/vgpt-il-extension-<version>.zip — the shape both "Load
 * unpacked" (after extracting) and the Chrome Web Store expect: the manifest at
 * the ROOT of the archive, not inside a folder. A zip with a wrapping directory
 * is the single most common reason an upload is rejected.
 *
 * Uses the platform's own archiver rather than a dependency: Node cannot write
 * a zip, and a hand-rolled one is a poor thing to gamble a store submission on.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
const dist = path.join(here, 'dist');
const manifestPath = path.join(dist, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('nothing to package — run "npm run build:ext" first');
  process.exit(1);
}

const { version, name } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const out = path.join(here, `vgpt-il-extension-${version}.zip`);
fs.rmSync(out, { force: true });

if (process.platform === 'win32') {
  // -Path dist\* (not dist) is what puts the files at the archive root.
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${dist}\\*' -DestinationPath '${out}' -Force`],
    { stdio: 'inherit' }
  );
} else {
  execFileSync('zip', ['-r', '-q', out, '.'], { cwd: dist, stdio: 'inherit' });
}

const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`packaged "${name}" ${version} → ${path.basename(out)} (${kb} KB)`);
console.log('load unpacked: extract it, then chrome://extensions → Developer mode → Load unpacked');
