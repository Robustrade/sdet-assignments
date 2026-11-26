import { vi } from 'vitest';
import { PaymentProvider } from '../../src/paymentProvider';
import { ChargeOutcome } from '../../src/types';

export interface RecordedChargeCall {
  customerId: string;
  amount: number;
  paymentMethodId: string;
  idempotencyRef: string;
  outcome: ChargeOutcome | 'error';
}

type QueuedResult = ChargeOutcome | Error;

/**
 * Configurable mock PaymentProvider backed by a single vi.fn() spy and call log.
 */
export class MockPaymentProvider implements PaymentProvider {
  private defaultResult: QueuedResult = 'success';
  private queuedResults: QueuedResult[] = [];
  private recordedCalls: RecordedChargeCall[] = [];

  public readonly chargeSpy = vi.fn<
    (customerId: string, amount: number, paymentMethodId: string, idempotencyRef: string) => Promise<ChargeOutcome>
  >(async (customerId, amount, paymentMethodId, idempotencyRef) => {
    const next = this.queuedResults.length > 0 ? this.queuedResults.shift()! : this.defaultResult;
    if (next instanceof Error) {
      this.recordedCalls.push({ customerId, amount, paymentMethodId, idempotencyRef, outcome: 'error' });
      throw next;
    }
    this.recordedCalls.push({ customerId, amount, paymentMethodId, idempotencyRef, outcome: next });
    return next;
  });

  respondWithSuccess(): this {
    this.defaultResult = 'success';
    return this;
  }

  respondWithDecline(): this {
    this.defaultResult = 'declined';
    return this;
  }

  respondWithTimeout(): this {
    this.defaultResult = 'timeout';
    return this;
  }

  respondWithError(error: Error = new Error('Gateway network failure')): this {
    this.defaultResult = error;
    return this;
  }

  queueOutcomes(...outcomes: QueuedResult[]): this {
    this.queuedResults.push(...outcomes);
    return this;
  }

  async charge(
    customerId: string,
    amount: number,
    paymentMethodId: string,
    idempotencyRef: string
  ): Promise<ChargeOutcome> {
    return this.chargeSpy(customerId, amount, paymentMethodId, idempotencyRef);
  }

  getCalls(): readonly RecordedChargeCall[] {
    return [...this.recordedCalls];
  }

  getCallCount(): number {
    return this.recordedCalls.length;
  }

  getLastCall(): RecordedChargeCall | undefined {
    return this.recordedCalls[this.recordedCalls.length - 1];
  }

  clearHistory(): void {
    this.recordedCalls = [];
    this.chargeSpy.mockClear();
  }
}
