import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/tests',
  timeout: 30_000,
  retries: 0,

  // Serial: SQLite write-lock is per-process; concurrency testing is done within individual tests.
  workers: 1,

  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    // baseURL is injected per-test via the custom fixture (read from .test-env.json)
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
});
