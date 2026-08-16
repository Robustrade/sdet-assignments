import { expect } from "vitest";

import type { SubscriptionRepository } from "../../src/repositories/in-memory.repository";

export class SubscriptionAssertions {
  constructor(private readonly repository: SubscriptionRepository) {}

  expectStatus(subscriptionId: string, expectedStatus: string): void {
    const subscription = this.repository.findSubscriptionById(subscriptionId);

    expect(
      subscription,
      `Subscription ${subscriptionId} should exist`,
    ).toBeDefined();

    expect(subscription?.status).toBe(expectedStatus);
  }

  expectPayment(invoiceId: string, expectedStatus: string): void {
    const payment = this.repository.findPaymentByInvoiceId(invoiceId);

    expect(
      payment,
      `Payment for invoice ${invoiceId} should exist`,
    ).toBeDefined();

    expect(payment?.status).toBe(expectedStatus);
  }

  expectSubscriptionExists(subscriptionId: string): void {
    expect(this.repository.findSubscriptionById(subscriptionId)).toBeDefined();
  }

  expectPaymentExists(invoiceId: string): void {
    expect(this.repository.findPaymentByInvoiceId(invoiceId)).toBeDefined();
  }
}

export default SubscriptionAssertions;
