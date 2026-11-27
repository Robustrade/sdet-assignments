import { HarnessOptions, TestHarness } from './TestHarness';

/**
 * Jest wiring: a fresh harness before each test, and the cross-table invariants checked after
 * each one. A scenario that leaves the system inconsistent fails even if its own assertions pass.
 */
export function useHarness(options: HarnessOptions & { checkInvariants?: boolean } = {}): () => TestHarness {
  let harness: TestHarness | undefined;

  beforeEach(async () => {
    harness = await TestHarness.create(options);
  });

  afterEach(async () => {
    try {
      if (harness && options.checkInvariants !== false) harness.invariants.assertHolds();
    } finally {
      await harness?.close();
      harness = undefined;
    }
  });

  return () => {
    if (!harness) throw new Error('Harness is only available inside a test');
    return harness;
  };
}
