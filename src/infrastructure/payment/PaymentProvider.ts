/**
 * Strategy Pattern - Payment Provider Interface
 *
 * This interface defines the contract for payment providers.
 * In tests, we use MockPaymentProvider.
 * In production, we'd use StripePaymentProvider or similar.
 */

import { ChargeResult, RefundResult } from '../../domain/subscription/types';

export interface ChargeMetadata {
  subscription_id: string;
  invoice_id?: string;
  customer_id?: string;
  idempotency_key?: string;
}

export interface PaymentProvider {
  /**
   * Charge a customer's payment method
   * @param amount Amount in cents
   * @param paymentMethodId Payment method identifier
   * @param metadata Additional charge metadata
   * @returns Charge result with success status and charge ID
   */
  chargeCustomer(
    amount: number,
    paymentMethodId: string,
    metadata: ChargeMetadata
  ): Promise<ChargeResult>;

  /**
   * Refund a previous charge
   * @param chargeId Charge identifier to refund
   * @returns Refund result with success status
   */
  refund(chargeId: string): Promise<RefundResult>;
}
