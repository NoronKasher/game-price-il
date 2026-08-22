import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

/**
 * Two builds from one source tree.
 *
 * The normal build talks to the Node server. The demo build (`--mode demo`) is
 * for GitHub Pages, which serves files and runs nothing — so `./api` is aliased
 * to a module that answers out of a recorded snapshot instead. The swap happens
 * at the module boundary rather than with branches inside the app, which keeps
 * demo code out of the real bundle entirely and means no component has to know
 * which build it is in.
 *
 * The switch is Vite's own `mode` rather than an environment variable, so the
 * one command works identically in PowerShell, bash and CI.
 */

/** The repo name a project Pages site is served under, e.g. /game-price-il/. */
const PAGES_BASE = process.env.PAGES_BASE ?? '/game-price-il/';

/**
 * The demo has to say what it is, on the page, without being asked.
 *
 * A visitor seeing live-looking Israeli prices should never be left to work out
 * that they are frozen — so the notice is injected into the HTML shell rather
 * than rendered by the app, which keeps it impossible to miss and impossible
 * for the real build to accidentally ship.
 */
function demoBanner(): Plugin {
  return {
    name: 'vgpt-demo-banner',
    transformIndexHtml(html) {
      const snapshot = path.join(import.meta.dirname, 'demo', 'public', 'snapshot.json');
      let captured = '';
      try {
        captured = (JSON.parse(fs.readFileSync(snapshot, 'utf8')).capturedAt ?? '').slice(0, 10);
      } catch {
        captured = '';
      }
      const when = captured ? ` ${captured}` : '';
      const banner = `
<div id="demo-note" dir="rtl">
  <strong>הדגמה</strong> — המחירים כאן צולמו מריצה אמיתית של הכלי${when ? ' בתאריך' + when : ''} והם קפואים.
  אין כאן שרת, כך שאין סריקה חיה; שינויים שתעשו נשמרים לביקור הזה בלבד.
  <a href="https://github.com/NoronKasher/game-price-il">קוד המקור והוראות הרצה מקומית</a>
  <button type="button" aria-label="סגירה" onclick="this.parentElement.remove()">✕</button>
</div>
<style>
  #demo-note {
    position: sticky; top: 0; z-index: 999;
    display: flex; gap: .6rem; align-items: center; flex-wrap: wrap;
    padding: .55rem 1rem; font-size: .85rem; line-height: 1.5;
    background: #1d2b3a; color: #d9e6f2;
    border-bottom: 1px solid #33506e;
  }
  #demo-note strong { color: #ffcc55; }
  #demo-note a { color: #7fc4ff; }
  #demo-note button {
    margin-inline-start: auto; background: none; border: 0;
    color: inherit; cursor: pointer; font-size: 1rem; padding: 0 .3rem;
  }
</style>
<script>
  // The two export buttons are links to server routes that do not exist on a
  // static host. The real exported files ship with the snapshot, so point the
  // links at those instead of letting them 404.
  document.addEventListener('click', function (e) {
    var a = e.target instanceof Element ? e.target.closest('a[href^="/api/export"]') : null;
    if (!a) return;
    e.preventDefault();
    var csv = a.getAttribute('href') === '/api/export.csv';
    window.location.href = (csv ? 'demo-export.csv' : 'demo-export.json');
  }, true);
</script>`;
      return html.replace('<body>', '<body>' + banner);
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: demo ? PAGES_BASE : '/',
    // Only in demo mode: ship the recorded snapshot and exports as static assets.
    publicDir: demo ? 'demo/public' : 'public',
    plugins: [react(), ...(demo ? [demoBanner()] : [])],
    resolve: {
      alias: demo
        ? // Forward slashes: rollup matches ids as posix paths even on Windows.
          [
            {
              find: './api',
              replacement: path.resolve(import.meta.dirname, 'src/api.demo.ts').split(path.sep).join('/'),
            },
          ]
        : [],
    },
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:5174',
      },
    },
  };
});
