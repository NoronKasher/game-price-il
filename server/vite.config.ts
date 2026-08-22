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
  // Vite's SSR mode externalises every dependency by default, whatever
  // rollupOptions.external says. Naming them here is what actually inlines them.
  // Inline the whole dependency tree. Naming packages individually left their
  // own dependencies (body-parser, qs, send…) as bare imports, which is the
  // worst of both worlds: a bundle that still needs a node_modules beside it.
  ssr: { noExternal: true, external: ['playwright-core'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    ssr: true,
    // .mjs, not .js: the bundle is ESM and the workspace root is not a module
    // package, so Node would reparse it and warn on every start.
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'server.mjs' },
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        // Only playwright-core stays out: it resolves paths to a browser on
        // disk at runtime, which a bundler cannot follow. express and cheerio
        // are inlined so a packaged app needs no node_modules beside it —
        // shipping a partial dependency tree is how installers break.
        'playwright-core',
      ],
      // SSR lib builds ignore lib.fileName and name the file after the entry,
      // so the extension has to be set here.
      output: { inlineDynamicImports: true, entryFileNames: 'index.mjs' },
    },
  },
});
