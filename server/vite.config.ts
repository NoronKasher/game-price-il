import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

/**
 * Bundle the server to plain JavaScript.
 *
 * Normally it runs straight from TypeScript on Node 24's type stripping, which
 * is lovely for development and useless for shipping: a packaged desktop app
 * embeds its own Node, and cannot be assumed to strip types. This produces one
 * ordinary ESM file that any modern Node — including Electron's — can run.
 *
 * Runtime dependencies stay external rather than inlined: express and cheerio
 * both do things bundlers guess badly at, and playwright-core resolves paths to
 * a browser at runtime. They travel as normal node_modules instead.
 */
export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    ssr: true,
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'server.js' },
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        'express',
        'cheerio',
        'playwright-core',
      ],
      output: { inlineDynamicImports: true },
    },
  },
});
