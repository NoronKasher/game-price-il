import { defineConfig } from 'vite';

/**
 * Builds the content script that lets the public demo use the extension.
 *
 * Separate from the worker build because a content script cannot be an ES
 * module in MV3 — it has to be a classic script, so this one emits IIFE.
 */
export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: 'src/bridge.ts',
      formats: ['iife'],
      name: 'VgptBridge',
      fileName: () => 'bridge.js',
    },
  },
});
