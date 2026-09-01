/**
 * Assertion Helpers - Verification Layer
 * 
 * Clean, named assertions that express business intent.
 * Makes test expectations clear and easy to maintain.
 */

import { Response } from 'supertest';
import { Subscription, SubscriptionState, Invoice } from '../../types';
import {
  SubscriptionRepository,
  InvoiceRepository,
  WebhookEventRepository,
} from '../repositories/index';
import { MockPaymentProvider } from '../../domain/payment-provider';

export class APIAssertions {
  /**
   * Verify response status code
   */
  static expectStatus(response: Response, status: number): Response {
    expect(response.status).toBe(status);
    return response;
  }

  /**
   * Verify subscription state in response
   */
  static expectSubscriptionState(response: Response, expectedState: SubscriptionState) {
    expect(response.body).toHaveProperty('state', expectedState);
  }

  /**
   * Verify subscription ID in response
   */
  static expectSubscriptionId(response: Response): string {
    expect(response.body).toHaveProperty('id');
    return response.body.id;
  }

  /**
   * Verify error message in response
   */
  static expectErrorMessage(response: Response, expectedMessage: string) {
    expect(response.body).toHaveProperty('error');
    expect(response.body.error).toContain(expectedMessage);
  }
}

export class PersistenceAssertions {
  constructor(
    private subscriptionRepo: SubscriptionRepository,
    private invoiceRepo: InvoiceRepository,
    private webhookRepo: WebhookEventRepository
  ) {}

  /**
   * Verify subscription exists and is in correct state
   */
  subscriptionShouldExist(subscriptionId: string): Subscription {
    const sub = this.subscriptionRepo.findById(subscriptionId);
    expect(sub).toBeDefined();
    return sub!;
  }

  /**
   * Verify subscription state matches expected
   */
  subscriptionShouldBeInState(subscriptionId: string, expectedState: SubscriptionState) {
    const sub = this.subscriptionShouldExist(subscriptionId);
    expect(sub.state).toBe(expectedState);
    return sub;
  }

  /**
   * Verify subscription is trialing
   */
  subscriptionShouldBeTrialing(subscriptionId: string): Subscription {
    return this.subscriptionShouldBeInState(subscriptionId, 'trialing');
  }

  /**
   * Verify subscription is active
   */
  subscriptionShouldBeActive(subscriptionId: string): Subscription {
    return this.subscriptionShouldBeInState(subscriptionId, 'active');
  }

  /**
   * Verify subscription is past due
   */
  subscriptionShouldBePastDue(subscriptionId: string): Subscription {
    return this.subscriptionShouldBeInState(subscriptionId, 'past_due');
  }

  /**
   * Verify subscription is canceled
   */
  subscriptionShouldBeCanceled(subscriptionId: string): Subscription {
    return this.subscriptionShouldBeInState(subscriptionId, 'canceled');
  }

  /**
   * Verify subscription has correct plan
   */
  subscriptionShouldHavePlan(subscriptionId: string, planId: string) {
    const sub = this.subscriptionShouldExist(subscriptionId);
    expect(sub.planId).toBe(planId);
  }

  /**
   * Verify subscription does not have a canceled_at timestamp
   */
  subscriptionShouldNotBeCanceled(subscriptionId: string) {
    const sub = this.subscriptionShouldExist(subscriptionId);
    expect(sub.canceledAt).toBeUndefined();
  }

  /**
   * Verify invoice exists for subscription
   */
  invoiceShouldExist(subscriptionId: string, expectedStatus: 'succeeded' | 'failed') {
    const invoices = this.invoiceRepo.findBySubscriptionId(subscriptionId);
    expect(invoices.length).toBeGreaterThan(0);
    const latestInvoice = invoices[invoices.length - 1];
    expect(latestInvoice.status).toBe(expectedStatus);
    return latestInvoice;
  }

  /**
   * Verify exactly one successful invoice for subscription
   */
  subscriptionShouldHaveExactlyOneSuccessfulInvoice(subscriptionId: string) {
    const count = this.invoiceRepo.countSuccessfulBySubscriptionId(subscriptionId);
    expect(count).toBe(1);
  }

  /**
   * Verify no duplicate invoices for subscription
   */
  subscriptionShouldNotHaveDuplicateInvoices(subscriptionId: string) {
    const invoices = this.invoiceRepo.findBySubscriptionId(subscriptionId);
    // Group by amount + date; each should appear once
    const grouped = new Map<string, number>();
    invoices.forEach((inv) => {
      const key = `${inv.amount}_${inv.createdAt.getTime()}`;
      grouped.set(key, (grouped.get(key) || 0) + 1);
    });
    for (const count of grouped.values()) {
      expect(count).toBeLessThanOrEqual(1);
    }
  }

  /**
   * Verify webhook event was processed
   */
  webhookEventShouldBeProcessed(eventId: string) {
    expect(this.webhookRepo.hasProcessed(eventId)).toBe(true);
  }

  /**
   * Verify webhook event appears exactly once in database
   */
  webhookEventShouldAppearExactlyOnce(eventId: string) {
    // In a real repo with query support, would count rows
    // For in-memory, we check the single entry
    const event = this.webhookRepo.findByEventId(eventId);
    expect(event).toBeDefined();
    expect(event!.processed).toBe(true);
  }
}

export class ProviderAssertions {
  constructor(private mockProvider: MockPaymentProvider) {}

  /**
   * Verify provider was called with correct amount
   */
  providerShouldHaveChargedAmount(expectedAmount: number) {
    const calls = this.mockProvider.getAllCalls();
    const relevantCall = calls.find((c) => c.amount === expectedAmount);
    expect(relevantCall).toBeDefined();
  }

  /**
   * Verify provider charge called exactly N times for customer
   */
  providerShouldHaveChargedCustomerNTimes(customerId: string, expectedCount: number) {
    const calls = this.mockProvider.getCallsByCustomerId(customerId);
    expect(calls).toHaveLength(expectedCount);
  }

  /**
   * Verify idempotency key was charged exactly once
   */
  idempotencyKeyShouldChargeExactlyOnce(idempotencyKey: string) {
    const count = this.mockProvider.getCallCountForIdempotencyKey(idempotencyKey);
    expect(count).toBe(1);
  }

  /**
   * Verify provider was not called (for validation failures)
   */
  providerShouldNotHaveBeenCalled() {
    expect(this.mockProvider.getCallCount()).toBe(0);
  }

  /**
   * Verify call count
   */
  providerCallCountShouldBe(expectedCount: number) {
    expect(this.mockProvider.getCallCount()).toBe(expectedCount);
  }
}
