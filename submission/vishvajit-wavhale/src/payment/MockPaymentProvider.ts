
import type {
  ChargeRequest,
  PaymentProvider,
  PaymentResult
} from './PaymentProvider.js';

export class MockPaymentProvider implements PaymentProvider {
  private requests: ChargeRequest[] = [];
  private queuedResults: PaymentResult[] = [];

  private readonly processedPayments = new Map<
    string,
    PaymentResult
  >();

  async charge(request: ChargeRequest): Promise<PaymentResult> {
    this.requests.push({ ...request });

    const existingResult = this.processedPayments.get(
      request.idempotencyKey
    );

    if (existingResult) {
      return { ...existingResult };
    }

    const result = this.queuedResults.length > 0
      ? this.queuedResults.shift()!
      : {
          status: 'succeeded' as const,
          providerReference: 'mock_default'
        };

    // A timeout is treated as an unresolved attempt.
    // The same key can be retried safely.
    if (result.status !== 'timeout') {
      this.processedPayments.set(
        request.idempotencyKey,
        { ...result }
      );
    }

    return { ...result };
  }

  queueResult(result: PaymentResult): void {
    this.queuedResults.push(result);
  }

  setNextResult(result: PaymentResult): void {
    this.queuedResults = [result];
  }

  getCallCount(): number {
    return this.requests.length;
  }

  getRequests(): ChargeRequest[] {
    return this.requests.map(request => ({ ...request }));
  }

  reset(): void {
    this.requests = [];
    this.queuedResults = [];
    this.processedPayments.clear();
  }
}
