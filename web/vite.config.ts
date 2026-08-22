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
 *
 * Naming the captured games is the important half. An earlier version dated the
 * prices and stopped there, which reads as "everything, as of that day" — so a
 * visitor searching anything else met "no results, try an English name" and drew
 * the only available conclusion, that the tool does not work. Stating the date
 * without stating the coverage was the more misleading of the two.
 */
function demoBanner(): Plugin {
  return {
    name: 'vgpt-demo-banner',
    transformIndexHtml(html) {
      const file = path.join(import.meta.dirname, 'demo', 'public', 'snapshot.json');
      let captured = '';
      let seeds: string[] = [];
      try {
        const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
        captured = (snapshot.capturedAt ?? '').slice(0, 10);
        seeds = snapshot.seeds ?? Object.keys(snapshot.searches ?? {});
      } catch {
        /* an absent snapshot is caught by the workflow, not by the banner */
      }
      const esc = (v: string) =>
        v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const when = captured ? ` מ‑${captured.split('-').reverse().join('.')}` : '';
      const chips = seeds
        .map((g) => `<button type="button" class="demo-game" data-demo-game="${esc(g)}">${esc(g)}</button>`)
        .join('');
      const banner = `
<div id="demo-note" dir="rtl">
  <button type="button" class="demo-x" aria-label="סגירה" onclick="this.parentElement.remove()">✕</button>
  <p>
    <strong>הדגמה</strong> — זו האפליקציה האמיתית, מול צילום של מחירים אמיתיים${when}.
    אין כאן שרת ולכן אין סריקה חיה, ו<strong>רק המשחקים שנקלטו בצילום מופיעים</strong>:
  </p>
  <div class="demo-games">${chips}</div>
  <p class="demo-fine">
    חיפוש של משחק אחר לא יחזיר תוצאות — זו מגבלה של ההדגמה, לא של הכלי.
    שינויים שתעשו נשמרים לביקור הזה בלבד.
    <a href="https://github.com/NoronKasher/game-price-il">קוד המקור והוראות הרצה מקומית ←</a>
  </p>
</div>
<style>
  #demo-note {
    position: sticky; top: 0; z-index: 999;
    padding: .6rem 1rem; font-size: .85rem; line-height: 1.6;
    background: #1d2b3a; color: #d9e6f2;
    border-bottom: 1px solid #33506e;
  }
  #demo-note p { margin: 0; }
  #demo-note strong { color: #ffcc55; }
  #demo-note a { color: #7fc4ff; }
  #demo-note .demo-fine { color: #9fb3c8; font-size: .8rem; }
  #demo-note .demo-games { display: flex; flex-wrap: wrap; gap: .35rem; margin: .35rem 0; }
  #demo-note .demo-game {
    font: inherit; font-size: .8rem; cursor: pointer;
    padding: .15rem .55rem; border-radius: 999px;
    background: #24384c; color: #d9e6f2; border: 1px solid #3d5f80;
  }
  #demo-note .demo-game:hover { background: #2f4a63; border-color: #5b8ab5; }
  #demo-note .demo-x {
    float: inline-end; background: none; border: 0;
    color: inherit; cursor: pointer; font-size: 1rem; padding: 0 .3rem;
  }
  /* The app's empty state blames the query ("try an English name"), which is
     wrong here — in the demo an unknown game is expected, not a mistake. */
  .empty::after {
    content: "בהדגמה מוצגים רק המשחקים שברשימה למעלה. הכלי המלא מחפש בכל החנויות בזמן אמת.";
    display: block; margin-top: .6rem; color: #9fb3c8; font-size: .85rem;
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

  // Naming the captured games is only useful if trying one is a click. React
  // owns the input, so its value has to be set through the native setter for
  // the change to register.
  document.addEventListener('click', function (e) {
    var chip = e.target instanceof Element ? e.target.closest('[data-demo-game]') : null;
    if (!chip) return;
    var input = document.querySelector('input[type=search]');
    if (!input) return;
    var setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setValue.call(input, chip.getAttribute('data-demo-game'));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (input.form) input.form.requestSubmit();
  }, true);
</script>`;
      return html.replace('<body>', '<body>' + banner);
    },
  };
}

/**
 * Which implementation of `./api` this build gets.
 *
 * Three shells, one UI: a Node server, a recorded snapshot, and an extension
 * service worker. The choice is a module alias, so no component ever learns
 * which one it is running against.
 */
const API_FOR_MODE: Record<string, string> = {
  demo: 'src/api.demo.ts',
  extension: 'src/api.extension.ts',
};

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const swap = API_FOR_MODE[mode];
  return {
    // An extension page is loaded from chrome-extension://<id>/, so its assets
    // must be referenced relatively.
    base: mode === 'extension' ? './' : demo ? PAGES_BASE : '/',
    // Only in demo mode: ship the recorded snapshot and exports as static assets.
    publicDir: demo ? 'demo/public' : 'public',
    plugins: [react(), ...(demo ? [demoBanner()] : [])],
    resolve: {
      alias: swap
        ? // Forward slashes: rollup matches ids as posix paths even on Windows.
          [
            {
              find: './api',
              replacement: path.resolve(import.meta.dirname, swap).split(path.sep).join('/'),
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
