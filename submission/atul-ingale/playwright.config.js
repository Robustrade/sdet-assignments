const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'automation/tests',
  webServer: {
    command: 'node server.js',
    port: 3000,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:3000/api',
    actionTimeout: 10000,
    trace: 'on-first-retry',
  },
});
