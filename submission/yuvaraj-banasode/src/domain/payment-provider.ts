/**
 * Payment Provider Interface (Strategy Pattern)
 * 
 * The service depends on this interface, not a concrete implementation.
 * Tests inject MockPaymentProvider; production would inject real provider.
 */

export interface PaymentProviderInterface {
  charge(
    customerId: string,
    amount: number,
    idempotencyKey: string
  ): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }>;
}

/**
 * Mock Payment Provider for Testing
 * 
 * Records all calls, supports configurable outcomes (success/decline/timeout).
 * Enables deterministic testing and call verification.
 */
export class MockPaymentProvider implements PaymentProviderInterface {
  private calls: Array<{
    customerId: string;
    amount: number;
    idempotencyKey: string;
    timestamp: Date;
  }> = [];

  private callsByIdempotencyKey: Map<string, number> = new Map();
  
  // Configurable behavior
  private nextOutcome: 'success' | 'decline' | 'timeout' = 'success';
  private nextTransactionId: string = 'txn_000';

  async charge(
    customerId: string,
    amount: number,
    idempotencyKey: string
  ): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    // Record this call
    this.calls.push({
      customerId,
      amount,
      idempotencyKey,
      timestamp: new Date(),
    });

    // Track call count per idempotency key (should be 1)
    const count = (this.callsByIdempotencyKey.get(idempotencyKey) || 0) + 1;
    this.callsByIdempotencyKey.set(idempotencyKey, count);

    // Simulate delay
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Return configured outcome
    if (this.nextOutcome === 'success') {
      return {
        success: true,
        transactionId: this.nextTransactionId,
      };
    } else if (this.nextOutcome === 'decline') {
      return {
        success: false,
        error: 'Card declined',
      };
    } else {
      // timeout: throw error
      throw new Error('Payment provider timeout');
    }
  }

  // Test helper methods

  getAllCalls() {
    return [...this.calls];
  }

  getCallCount(): number {
    return this.calls.length;
  }

  getCallsByCustomerId(customerId: string) {
    return this.calls.filter((c) => c.customerId === customerId);
  }

  getCallsByIdempotencyKey(key: string) {
    return this.calls.filter((c) => c.idempotencyKey === key);
  }

  getCallCountForIdempotencyKey(key: string): number {
    return this.callsByIdempotencyKey.get(key) || 0;
  }

  setNextOutcome(outcome: 'success' | 'decline' | 'timeout') {
    this.nextOutcome = outcome;
  }

  setNextTransactionId(txnId: string) {
    this.nextTransactionId = txnId;
  }

  reset() {
    this.calls = [];
    this.callsByIdempotencyKey.clear();
    this.nextOutcome = 'success';
    this.nextTransactionId = 'txn_000';
  }
}
