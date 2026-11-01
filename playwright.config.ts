import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true, // safe: every test gets its own server + database
  reporter: [
    ['list'], // console output
    ['html', { open: 'never' }], // playwright-report/index.html  (npm run report)
    ['junit', { outputFile: 'test-results/junit.xml' }], // for CI tools
  ],
});
