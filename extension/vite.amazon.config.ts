import { defineConfig } from 'vite';
import path from 'node:path';

/**
 * The Amazon content script.
 *
 * A separate build for the same reason bridge.js is: a content script cannot be
 * an ES module, so it needs its own IIFE bundle rather than a chunk of the
 * worker's module graph.
 */
export default defineConfig({
  root: import.meta.dirname,
  define: { 'process.env': '{}' },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/amazonContent.ts'),
      formats: ['iife'],
      name: 'VgptAmazon',
      fileName: () => 'amazon.js',
    },
  },
});
