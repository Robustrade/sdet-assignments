/**
 * Database Assertion Helpers
 *
 * Provides high-level assertions for database state validation.
 * Keeps raw database queries out of test files.
 */

import { InMemorySubscriptionRepository } from '../../src/infrastructure/persistence/InMemorySubscriptionRepository';
import { InMemoryInvoiceRepository } from '../../src/infrastructure/persistence/InMemoryInvoiceRepository';
import { InMemoryWebhookEventRepository } from '../../src/infrastructure/persistence/InMemoryWebhookEventRepository';
import { SubscriptionStatus, InvoiceStatus } from '../../src/domain/subscription/types';

export interface Repositories {
  subscriptions: InMemorySubscriptionRepository;
  invoices: InMemoryInvoiceRepository;
  webhookEvents: InMemoryWebhookEventRepository;
}

export class DatabaseAssertions {
  constructor(private repos: Repositories) {}

  /**
   * Assert that a subscription exists with the given status
   */
  async assertSubscriptionExists(id: string, expectedStatus: SubscriptionStatus): Promise<void> {
    const subscription = this.repos.subscriptions.findById(id);

    if (!subscription) {
      throw new Error(`Expected subscription ${id} to exist, but it does not`);
    }

    if (subscription.status !== expectedStatus) {
      throw new Error(
        `Expected subscription ${id} to have status '${expectedStatus}', but found '${subscription.status}'`
      );
    }
  }

  /**
   * Assert that a subscription does not exist
   */
  async assertSubscriptionNotExists(id: string): Promise<void> {
    const subscription = this.repos.subscriptions.findById(id);

    if (subscription) {
      throw new Error(`Expected subscription ${id} not to exist, but it does`);
    }
  }

  /**
   * Assert the number of invoices for a subscription
   */
  async assertInvoiceCount(subscriptionId: string, expectedCount: number): Promise<void> {
    const invoices = this.repos.invoices.findBySubscriptionId(subscriptionId);

    if (invoices.length !== expectedCount) {
      throw new Error(
        `Expected ${expectedCount} invoices for subscription ${subscriptionId}, but found ${invoices.length}`
      );
    }
  }

  /**
   * Assert that an invoice exists with the given status
   */
  async assertInvoiceStatus(invoiceId: string, expectedStatus: InvoiceStatus): Promise<void> {
    const invoice = this.repos.invoices.findById(invoiceId);

    if (!invoice) {
      throw new Error(`Expected invoice ${invoiceId} to exist, but it does not`);
    }

    if (invoice.status !== expectedStatus) {
      throw new Error(
        `Expected invoice ${invoiceId} to have status '${expectedStatus}', but found '${invoice.status}'`
      );
    }
  }

  /**
   * Assert that a webhook event was processed exactly once
   */
  async assertWebhookProcessedOnce(eventId: string): Promise<void> {
    const events = this.repos.webhookEvents.findByEventId(eventId);

    if (events.length === 0) {
      throw new Error(`Expected webhook event ${eventId} to be processed, but it was not`);
    }

    if (events.length > 1) {
      throw new Error(
        `Expected webhook event ${eventId} to be processed once, but found ${events.length} records`
      );
    }
  }

  /**
   * Assert that duplicate webhook was flagged correctly
   */
  async assertWebhookDuplicateFlagged(eventId: string): Promise<void> {
    const events = this.repos.webhookEvents.findByEventId(eventId);

    if (events.length < 2) {
      throw new Error(`Expected at least 2 webhook events for ${eventId}, but found ${events.length}`);
    }

    const duplicateEvent = events.find((e) => e.is_duplicate);
    if (!duplicateEvent) {
      throw new Error(`Expected duplicate webhook event ${eventId} to be flagged, but none were`);
    }
  }

  /**
   * Assert that no duplicate invoices exist for a subscription
   */
  async assertNoDuplicateInvoices(subscriptionId: string): Promise<void> {
    const invoices = this.repos.invoices.findBySubscriptionId(subscriptionId);
    const invoiceIds = invoices.map((inv) => inv.id);
    const uniqueIds = new Set(invoiceIds);

    if (uniqueIds.size !== invoices.length) {
      throw new Error(
        `Expected no duplicate invoices for subscription ${subscriptionId}, but found duplicates`
      );
    }
  }

  /**
   * Assert that a subscription is in the canceled state and cannot be modified
   */
  async assertSubscriptionCanceled(id: string): Promise<void> {
    const subscription = this.repos.subscriptions.findById(id);

    if (!subscription) {
      throw new Error(`Expected subscription ${id} to exist, but it does not`);
    }

    if (subscription.status !== 'canceled') {
      throw new Error(
        `Expected subscription ${id} to be canceled, but status is '${subscription.status}'`
      );
    }

    if (!subscription.canceled_at) {
      throw new Error(`Expected subscription ${id} to have canceled_at timestamp, but it does not`);
    }
  }

  /**
   * Assert that an active subscription has at least one successful payment
   */
  async assertActiveHasSuccessfulPayment(subscriptionId: string): Promise<void> {
    const subscription = this.repos.subscriptions.findById(subscriptionId);

    if (!subscription) {
      throw new Error(`Expected subscription ${subscriptionId} to exist, but it does not`);
    }

    if (subscription.status !== 'active') {
      throw new Error(
        `Subscription ${subscriptionId} is not active (status: ${subscription.status})`
      );
    }

    const invoices = this.repos.invoices.findBySubscriptionId(subscriptionId);
    const paidInvoice = invoices.find((inv) => inv.status === 'paid');

    if (!paidInvoice) {
      throw new Error(
        `Expected active subscription ${subscriptionId} to have at least one paid invoice, but found none`
      );
    }
  }
}
