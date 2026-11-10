import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: 'http://localhost:4000' },

  // Starts the demo app before the tests and stops it after.
  webServer: {
    command: 'node --no-warnings demo-app/server.js',
    url: 'http://localhost:4000/health',
  },
});
