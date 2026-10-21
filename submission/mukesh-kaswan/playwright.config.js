const { defineConfig } = require('@playwright/test');

// API-only suite: no browsers are launched, so `npx playwright install` is not needed.
module.exports = defineConfig({
  testDir: './tests/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
});
