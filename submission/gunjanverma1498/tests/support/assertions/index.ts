import type { TestEnvironment } from '../fixtures/TestEnvironment';
import { PersistenceVerifier } from './PersistenceVerifier';
import { ProviderAssertions } from './ProviderAssertions';

export { PersistenceVerifier } from './PersistenceVerifier';
export { ProviderAssertions } from './ProviderAssertions';

/**
 * Small facade so scenarios read fluently:
 *   verify(env).persisted.subscriptionStatus(id, 'active');
 *   verify(env).provider.chargedExactlyOnce();
 */
export function verify(env: TestEnvironment) {
  return {
    persisted: new PersistenceVerifier(env),
    provider: new ProviderAssertions(env.provider),
  };
}
