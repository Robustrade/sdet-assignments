import { defineConfig } from '@playwright/test';
import { env } from './config/env';
import { secrets } from './config/secrets';

export default defineConfig({
  testDir: './tests',

  fullyParallel: true,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  workers: process.env.CI ? 1 : undefined,

  reporter: [['list'], ['html', { open: 'never' }]],

  webServer: {
    command: 'npx json-server --watch db.json --port 3000 --host 0.0.0.0',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },

  use: {
    baseURL: env.baseUrl,

    extraHTTPHeaders: {
      'Content-Type': 'application/json',
      ...(secrets.apiKey
        ? {
            Authorization: `Bearer ${secrets.apiKey}`,
          }
        : {}),
    },

    trace: 'retain-on-failure',

    screenshot: 'only-on-failure',
  },

  timeout: 30_000,

  expect: {
    timeout: 10_000,
  },
});