import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    // Each test builds its own in-memory database, so files can run in parallel safely.
    fileParallelism: true,
  },
});
