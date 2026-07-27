const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['allure-playwright', { 
      outputFolder: 'allure-results',
      detail: true,
      suiteTitle: true
    }]
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  projects: [
    {
      name: 'api-tests',
      testMatch: /.*api.*\.spec\.js/,
    },
    {
      name: 'database-tests',
      testMatch: /.*database.*\.spec\.js/,
    },
    {
      name: 'e2e-tests',
      testMatch: /.*e2e.*\.spec\.js/,
    },
    {
      name: 'reliability-tests',
      testMatch: /.*reliability.*\.spec\.js/,
    },
    {
      name: 'concurrency-tests',
      testMatch: /.*concurrency.*\.spec\.js/,
    },
  ],
});
