/**
 * Repository Layer - Data Access Abstraction
 * 
 * Repositories encapsulate all persistence queries.
 * This keeps test code clean and database schema changes localized.
 */

import { Subscription, Invoice, WebhookEvent, SubscriptionState } from '../../types';
import { InMemoryDatabase } from '../../infrastructure/in-memory-database';

export class SubscriptionRepository {
  constructor(private db: InMemoryDatabase) {}

  findById(id: string): Subscription | undefined {
    return this.db.getSubscription(id);
  }

  findByCustomerId(customerId: string): Subscription[] {
    return this.db.getSubscriptionsByCustomerId(customerId);
  }

  save(subscription: Subscription): void {
    this.db.saveSubscription(subscription);
  }

  updateState(id: string, newState: SubscriptionState): Subscription {
    return this.db.updateSubscriptionState(id, newState);
  }

  getAll(): Subscription[] {
    // Helper for debugging; not used in tests typically
    const subs: Subscription[] = [];
    // Would iterate internal store in real repo
    return subs;
  }
}

export class InvoiceRepository {
  constructor(private db: InMemoryDatabase) {}

  findById(id: string): Invoice | undefined {
    return this.db.getInvoice(id);
  }

  findBySubscriptionId(subscriptionId: string): Invoice[] {
    return this.db.getInvoicesBySubscriptionId(subscriptionId);
  }

  save(invoice: Invoice): void {
    this.db.saveInvoice(invoice);
  }

  /**
   * Assertion helper: Get the most recent invoice for a subscription
   */
  getLatestBySubscriptionId(subscriptionId: string): Invoice | undefined {
    const invoices = this.findBySubscriptionId(subscriptionId);
    return invoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  /**
   * Assertion helper: Count successful invoices for a subscription
   */
  countSuccessfulBySubscriptionId(subscriptionId: string): number {
    return this.findBySubscriptionId(subscriptionId).filter(
      (i) => i.status === 'succeeded'
    ).length;
  }

  /**
   * Assertion helper: Count failed invoices for a subscription
   */
  countFailedBySubscriptionId(subscriptionId: string): number {
    return this.findBySubscriptionId(subscriptionId).filter(
      (i) => i.status === 'failed'
    ).length;
  }
}

export class WebhookEventRepository {
  constructor(private db: InMemoryDatabase) {}

  findByEventId(eventId: string): WebhookEvent | undefined {
    return this.db.getWebhookEvent(eventId);
  }

  save(event: WebhookEvent): void {
    this.db.saveWebhookEvent(event);
  }

  hasProcessed(eventId: string): boolean {
    return this.db.hasProcessedEvent(eventId);
  }

  /**
   * Assertion helper: Get all processed events for a subscription
   */
  getProcessedEventsForSubscription(
    subscriptionId: string
  ): WebhookEvent[] {
    // In a real repo, would query DB
    // For in-memory, would iterate and filter
    return [];
  }
}
