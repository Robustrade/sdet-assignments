import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/specs/**/*.spec.ts'],
    // Every test builds its own in-memory DB via TestEnvironment, so files can run in parallel safely.
    restoreMocks: true,
  },
});
