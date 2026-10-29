import type { ChargeResult, PaymentProvider } from './PaymentProvider';

/**
 * Default when no provider is injected. It fails loudly (HTTP 500) instead of silently
 * approving or declining, so a missing wiring can never look like a real payment decision.
 */
export class UnconfiguredPaymentProvider implements PaymentProvider {
  async charge(): Promise<ChargeResult> {
    throw new Error('No payment provider configured: inject one through createApp({ paymentProvider })');
  }
}
