import { defineConfig } from 'vite';
import path from 'node:path';

/**
 * The store-page content script.
 *
 * Its own IIFE bundle for the same reason as bridge.js and amazon.js: a content
 * script cannot be an ES module, so it cannot be a chunk of the worker's module
 * graph.
 */
export default defineConfig({
  root: import.meta.dirname,
  define: { 'process.env': '{}' },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/storeContent.ts'),
      formats: ['iife'],
      name: 'VgptStorePage',
      fileName: () => 'storepage.js',
    },
  },
});
