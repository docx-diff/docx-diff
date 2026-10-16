import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Served from a GitHub Pages project subpath in production, e.g. BASE_PATH=/docx-diff/.
const base = process.env.BASE_PATH ?? '/';

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
      ],
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
