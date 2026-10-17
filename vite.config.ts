import { readdirSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Published at the root of https://docx-diff.github.io/; BASE_PATH=/<subpath>/ builds for a subpath.
const base = process.env.BASE_PATH ?? '/';

const ENGINE_DIR = 'node_modules/docxodus/dist/wasm/_framework';
const engineFiles = readdirSync(ENGINE_DIR).filter((name) => !name.endsWith('.br'));

// The engine does not report its package version at run time; saved reviews are tied to it.
const docxodusVersion: string = JSON.parse(
  readFileSync(new URL('./node_modules/docxodus/package.json', import.meta.url), 'utf8'),
).version;

export default defineConfig({
  base,
  define: {
    __DOCXODUS_VERSION__: JSON.stringify(docxodusVersion),
  },
  plugins: [
    react(),
    // The engine runtime is loaded at run time from <base>/wasm/_framework/ (see src/engine/docxodus.ts).
    // GitHub Pages ignores the precompressed .br files, so they are not copied.
    viteStaticCopy({
      targets: [
        {
          src: ['node_modules/docxodus/dist/wasm/_framework/*', '!**/*.br'],
          dest: 'wasm/_framework',
          rename: { stripBase: true },
        },
        { src: 'LICENSE', dest: '.' },
        { src: 'node_modules/docxodus/LICENSE', dest: 'licenses', rename: { stripBase: true, name: 'docxodus.txt' } },
      ],
    }),
    // Precaches the app and the engine, so repeat visits start quickly and work offline
    // (GitHub Pages lets browsers cache files for 10 minutes only).
    VitePWA({
      // Registered by the app once the engine is ready (src/serviceWorker.ts). Not the autoUpdate
      // module either: it reloads open pages, which would interrupt a review.
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{html,js,css,wasm}'],
        // The scope is the whole origin at the root, which also serves the org's other GitHub Pages
        // sites (/<repo>/) and 404s: only the app's own page falls back to index.html.
        navigateFallbackAllowlist: [new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(index\\.html)?$`)],
        // dotnet.native.wasm is ~10 MB.
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        // A new version takes over at once; open pages keep what they loaded (nothing is loaded lazily).
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        manifestTransforms: [
          async (entries) => {
            const missing = engineFiles.filter((name) => !entries.some((entry) => entry.url === `wasm/_framework/${name}`));
            if (missing.length > 0) throw new Error(`Engine files missing from the precache: ${missing.join(', ')}`);
            return { manifest: entries, warnings: [] };
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // The package loads dotnet.js with a dynamic import that must not be pre-bundled.
    exclude: ['docxodus'],
  },
});
