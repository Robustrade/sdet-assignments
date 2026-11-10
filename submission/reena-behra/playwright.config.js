import { defineConfig, devices } from '@playwright/test';

// node:sqlite prints an "experimental" warning on every process; hide it to keep output readable.
process.env.NODE_NO_WARNINGS = '1';

const PORT = process.env.PORT ?? '4000';
process.env.PORT = PORT; // test workers use this to find the matching database file
export const APP_URL = `http://localhost:${PORT}`;

// The Sauce Demo UI tests run against saucedemo.com and don't need the demo app.
const runningOnlyUiTests = process.argv.includes('--project=ui');

export default defineConfig({
  fullyParallel: true,
  retries: 0, // a flaky test should fail loudly, not be hidden by a retry
  reporter: [['list'], ['html', { open: 'never' }]],

  // Starts the demo billing app before the tests run, and stops it afterwards.
  webServer: runningOnlyUiTests ? undefined : {
    command: `node --no-warnings demo-app/server.js`,
    env: { PORT: String(PORT) },
    url: `${APP_URL}/health`,
    // Always start our own copy. Reusing an app that is already running could mean the tests
    // talk to a different app than the database file they read (a silent false result).
    reuseExistingServer: false,
  },

  projects: [
    {
      name: 'api',
      testMatch: ['tests/api/**/*.spec.js', 'tests/e2e/**/*.spec.js'],
      use: { baseURL: APP_URL },
    },
    {
      name: 'ui',
      testMatch: ['tests/ui/**/*.spec.js'],
      use: { ...devices['Desktop Chrome'], baseURL: 'https://www.saucedemo.com' },
    },
  ],
});
