// playwright.config.js
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  workers: 1,           // keep sequential; concurrency tests use Promise.all internally
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:3001',
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },
  globalSetup: require.resolve('./fixtures/global-setup.js'),
  globalTeardown: require.resolve('./fixtures/global-teardown.js'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
});
