import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Two projects: UI and model code under jsdom; engine code (which runs the real Docxodus WASM) under Node.
const engineTests = ['src/engine/**/*.test.ts', 'test/**/*.test.ts'];

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
            environment: 'jsdom',
            include: ['src/**/*.test.{ts,tsx}'],
            exclude: engineTests,
          },
        },
        {
          extends: true,
          test: {
            name: 'engine',
            environment: 'node',
            include: engineTests,
            testTimeout: 120_000,
            hookTimeout: 120_000,
          },
        },
      ],
    },
  }),
);
