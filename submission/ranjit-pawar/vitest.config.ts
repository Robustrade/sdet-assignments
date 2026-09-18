import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/specs/**/*.spec.ts'],
    // Each spec file gets its own module registry / process, so no shared state
    // can leak between files. Within a file, isolation is enforced by
    // TestEnvironment.create() in beforeEach (fresh DB, clock, mocks).
    sequence: { shuffle: false },
    reporters: ['default']
  }
});
