import { defineConfig } from 'vite';
import path from 'node:path';

/**
 * Builds the service worker only — the UI is built from web/ with `--mode
 * extension` and lands in the same dist/ first.
 *
 * MV3 loads the worker as a single module file: no code splitting and no hashed
 * filename, because manifest.json names it literally.
 */
export default defineConfig({
  // Invoked from the repo root (`vite build -c extension/vite.config.ts`), so
  // say where "here" is or the entry and outDir resolve against the wrong tree.
  root: import.meta.dirname,
  /**
   * `process` does not exist in a service worker.
   *
   * Two adapters read an optional override out of `process.env` at MODULE
   * scope, which in Chrome is a ReferenceError thrown while the module is being
   * evaluated — so the worker's script never finishes, no listener is ever
   * registered, and every message to it goes unanswered. Nothing is logged
   * anywhere obvious: the worker still appears in devtools, it is simply empty.
   *
   * Replacing the expression at build time removes the reference entirely.
   */
  define: {
    'process.env': '{}',
  },
  resolve: {
    alias: [
      {
        // keys.ts reads a file from disk, which pulls node:fs — and through
        // db.ts, node:sqlite — into a bundle that has neither. CheapShark
        // imports GG.deals and ITAD, so this one substitution is what keeps the
        // whole adapter graph importable unchanged.
        //
        // Matched against the import SPECIFIER ("../keys.ts"), not a resolved
        // path — an absolute `find` silently never fires. It must also match the
        // WHOLE specifier: a RegExp alias replaces only the part it matched, so
        // a partial match leaves the leading "../" glued to the replacement.
        find: /^.*\/keys\.ts$/,
        replacement: path.resolve(import.meta.dirname, 'src/keys.browser.ts').split(path.sep).join('/'),
      },
      {
        // SQLite for IndexedDB. Everything above the storage layer — capture,
        // alerts, notifications, CSV export, suggestions — is unchanged.
        find: /^.*\/db\.ts$/,
        replacement: path.resolve(import.meta.dirname, 'src/db.browser.ts').split(path.sep).join('/'),
      },
      {
        // Reading the Steam client's own files off disk. node:fs again, and the
        // extension has no substitute for it — it keeps the API-key route.
        find: /^.*\/steamLocal\.ts$/,
        replacement: path.resolve(import.meta.dirname, 'src/steamLocal.browser.ts').split(path.sep).join('/'),
      },
      {
        // Hash recovery drives Playwright, which cannot exist here. The stub
        // keeps PlayStation searching on the known hash rather than dropping
        // the source entirely.
        find: /^.*\/psnHash\.ts$/,
        replacement: path.resolve(import.meta.dirname, 'src/psnHash.browser.ts').split(path.sep).join('/'),
      },
    ],
  },
  build: {
    outDir: 'dist',
    // The UI build runs first and owns the directory; this one adds to it.
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: 'src/background.ts',
      formats: ['es'],
      fileName: () => 'background.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
