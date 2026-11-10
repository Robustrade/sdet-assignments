/**
 * Mock Payment Provider (Test Double)
 *
 * Implements PaymentProvider interface for testing.
 * Allows tests to:
 * - Simulate success, decline, or timeout
 * - Verify call count and arguments
 * - Avoid real external API calls
 */

import { PaymentProvider, ChargeMetadata } from './PaymentProvider';
import { ChargeResult, RefundResult } from '../../domain/subscription/types';

export type SimulatedOutcome = 'success' | 'decline' | 'timeout';

export interface ChargeCall {
  amount: number;
  paymentMethodId: string;
  metadata: ChargeMetadata;
  timestamp: Date;
}

export class MockPaymentProvider implements PaymentProvider {
  private chargeCalls: ChargeCall[] = [];
  private refundCalls: string[] = [];
  private simulatedOutcome: SimulatedOutcome = 'success';

  /**
   * Configure mock to simulate successful charges
   */
  simulateSuccess(): void {
    this.simulatedOutcome = 'success';
  }

  /**
   * Configure mock to simulate declined charges
   */
  simulateDecline(): void {
    this.simulatedOutcome = 'decline';
  }

  /**
   * Configure mock to simulate network timeout
   */
  simulateTimeout(): void {
    this.simulatedOutcome = 'timeout';
  }

  /**
   * Mock implementation of charge customer
   */
  async chargeCustomer(
    amount: number,
    paymentMethodId: string,
    metadata: ChargeMetadata
  ): Promise<ChargeResult> {
    // Record the call for later verification
    this.chargeCalls.push({
      amount,
      paymentMethodId,
      metadata,
      timestamp: new Date(),
    });

    // Simulate the configured outcome
    switch (this.simulatedOutcome) {
      case 'success':
        return {
          success: true,
          chargeId: `ch_mock_${Date.now()}`,
        };

      case 'decline':
        return {
          success: false,
          error: 'card_declined',
        };

      case 'timeout':
        throw new Error('Network timeout - payment provider unreachable');

      default:
        throw new Error(`Unknown simulated outcome: ${this.simulatedOutcome}`);
    }
  }

  /**
   * Mock implementation of refund
   */
  async refund(chargeId: string): Promise<RefundResult> {
    this.refundCalls.push(chargeId);

    return {
      success: true,
      refundId: `re_mock_${Date.now()}`,
    };
  }

  // ========== Test Assertion Helpers ==========

  /**
   * Get total number of charge calls made
   */
  getCallCount(): number {
    return this.chargeCalls.length;
  }

  /**
   * Get the last charge call made
   */
  getLastCall(): ChargeCall | undefined {
    return this.chargeCalls[this.chargeCalls.length - 1];
  }

  /**
   * Get all charge calls made
   */
  getAllCalls(): ChargeCall[] {
    return [...this.chargeCalls];
  }

  /**
   * Assert that charge was called exactly once
   */
  assertCalledOnce(): void {
    if (this.chargeCalls.length !== 1) {
      throw new Error(
        `Expected chargeCustomer to be called once, but was called ${this.chargeCalls.length} times`
      );
    }
  }

  /**
   * Assert that charge was called with specific amount
   */
  assertCalledWith(expectedAmount: number): void {
    const lastCall = this.getLastCall();
    if (!lastCall) {
      throw new Error('Expected chargeCustomer to be called, but it was not');
    }
    if (lastCall.amount !== expectedAmount) {
      throw new Error(
        `Expected charge amount ${expectedAmount}, but got ${lastCall.amount}`
      );
    }
  }

  /**
   * Assert that charge was not called
   */
  assertNotCalled(): void {
    if (this.chargeCalls.length > 0) {
      throw new Error(
        `Expected chargeCustomer not to be called, but was called ${this.chargeCalls.length} times`
      );
    }
  }

  /**
   * Reset all recorded calls and state
   */
  reset(): void {
    this.chargeCalls = [];
    this.refundCalls = [];
    this.simulatedOutcome = 'success';
  }
}
