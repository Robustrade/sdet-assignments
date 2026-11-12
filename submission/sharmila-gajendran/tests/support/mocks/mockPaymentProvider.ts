import {
  ProviderTimeoutError,
  type ChargeRequest,
  type ChargeResult,
  type PaymentProvider,
} from '../../../src/providers/paymentProvider';

export type ChargeBehaviour = 'succeed' | 'decline' | 'timeout' | 'pending';

/**
 * Test double for the payment provider, plugged in through the PaymentProvider interface.
 * Every call is recorded with its arguments, and the result of each call is set by the test.
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly recorded: ChargeRequest[] = [];
  private readonly scripted: ChargeBehaviour[] = [];
  private fallback: ChargeBehaviour = 'succeed';
  private sequence = 0;

  get calls(): readonly ChargeRequest[] {
    return this.recorded;
  }

  /** Results for the next charges, in order. After these run out, the default applies. */
  respondWith(...behaviours: ChargeBehaviour[]): this {
    this.scripted.push(...behaviours);
    return this;
  }

  /** Result for every charge that has no scripted response. Starts as 'succeed'. */
  byDefault(behaviour: ChargeBehaviour): this {
    this.fallback = behaviour;
    return this;
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.recorded.push({ ...request });
    const behaviour = this.scripted.shift() ?? this.fallback;
    this.sequence += 1;
    const chargeId = `ch_mock_${this.sequence}`;
    switch (behaviour) {
      case 'succeed':
        return { status: 'succeeded', chargeId };
      case 'decline':
        return { status: 'declined', chargeId, reason: 'card_declined' };
      case 'pending':
        return { status: 'pending', chargeId };
      case 'timeout':
        throw new ProviderTimeoutError();
    }
  }
}
