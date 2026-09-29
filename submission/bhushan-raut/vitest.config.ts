import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/specs/**/*.spec.ts'],
    // Every test builds its own in-memory DB via TestEnvironment, so files can run in parallel safely.
    // Threads + a small cap: the whole suite runs in about a second, so one process per core
    // buys nothing and exhausts memory on smaller machines.
    pool: 'threads',
    maxWorkers: 2,
    restoreMocks: true,
  },
});
