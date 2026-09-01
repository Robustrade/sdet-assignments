/**
 * In-Memory Database Mock
 * 
 * Simple in-memory store for testing. In production, would use real DB.
 * This keeps test setup friction low while still validating persistence logic.
 */

import {
  Customer,
  Subscription,
  Invoice,
  WebhookEvent,
  SubscriptionState,
} from '../types';

export class InMemoryDatabase {
  private customers: Map<string, Customer> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private invoices: Map<string, Invoice> = new Map();
  private webhookEvents: Map<string, WebhookEvent> = new Map();

  // Customers
  saveCustomer(customer: Customer): void {
    this.customers.set(customer.id, customer);
  }

  getCustomer(id: string): Customer | undefined {
    return this.customers.get(id);
  }

  // Subscriptions
  saveSubscription(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  getSubscription(id: string): Subscription | undefined {
    const sub = this.subscriptions.get(id);
    return sub ? { ...sub } : undefined;
  }

  getSubscriptionsByCustomerId(customerId: string): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (s) => s.customerId === customerId
    );
  }

  updateSubscriptionState(
    subscriptionId: string,
    newState: SubscriptionState
  ): Subscription {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new Error(`Subscription not found: ${subscriptionId}`);
    sub.state = newState;
    sub.updatedAt = new Date();
    return { ...sub };
  }

  // Invoices
  saveInvoice(invoice: Invoice): void {
    this.invoices.set(invoice.id, invoice);
  }

  getInvoice(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  getInvoicesBySubscriptionId(subscriptionId: string): Invoice[] {
    return Array.from(this.invoices.values()).filter(
      (i) => i.subscriptionId === subscriptionId
    );
  }

  // Webhook Events
  saveWebhookEvent(event: WebhookEvent): void {
    this.webhookEvents.set(event.eventId, event);
  }

  getWebhookEvent(eventId: string): WebhookEvent | undefined {
    return this.webhookEvents.get(eventId);
  }

  hasProcessedEvent(eventId: string): boolean {
    const event = this.webhookEvents.get(eventId);
    return event?.processed || false;
  }

  markEventProcessed(eventId: string): void {
    const event = this.webhookEvents.get(eventId);
    if (event) {
      event.processed = true;
      event.processedAt = new Date();
    }
  }

  // Cleanup
  clear(): void {
    this.customers.clear();
    this.subscriptions.clear();
    this.invoices.clear();
    this.webhookEvents.clear();
  }
}
