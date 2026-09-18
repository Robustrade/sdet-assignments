import { afterEach, beforeEach } from 'vitest';
import { assertSystemInvariants } from '../assertions/invariant-checker';
import { TestEnvironment, type TestEnvironmentOptions } from './test-environment';

export interface SuiteContext {
  readonly env: TestEnvironment;
}

/**
 * Standard suite wiring, used by every spec file:
 *   - a fresh TestEnvironment per test (isolation, no stale data)
 *   - the system-wide invariants asserted after every test
 *
 * Because each test builds its own store, clock and mocks, tests are order- and
 * parallelism-independent and there is no clean-up step to forget.
 */
export function useBillingSystem(options: TestEnvironmentOptions = {}): SuiteContext {
  let current: TestEnvironment | null = null;

  beforeEach(() => {
    current = TestEnvironment.create(options);
  });

  afterEach(async () => {
    if (current) await assertSystemInvariants(current);
    current = null;
  });

  return {
    get env(): TestEnvironment {
      if (!current) throw new Error('TestEnvironment is only available inside a test');
      return current;
    }
  };
}
