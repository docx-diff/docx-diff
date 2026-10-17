import { defineConfig, devices } from '@playwright/test';

// The e2e tests run against a production build served at the root, as published on https://docx-diff.github.io/.
const BASE_PATH = '/';
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    env: { BASE_PATH },
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
