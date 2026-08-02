import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // SQLite in-memory doesn't like concurrent access, we run sequentially or use workers: 1
  retries: 0,
  workers: 1, 
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
  },
});
