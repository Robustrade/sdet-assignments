import { Subscription } from '../builders/subscription-builder';

export interface Invoice {
  id: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: 'paid' | 'failed';
  providerPaymentId?: string;
}

export interface WebhookEvent {
  eventId: string;
  subscriptionId: string;
  type: string;
  processed: boolean;
}

export class InMemoryBillingRepository {
  private subscriptions = new Map<string, Subscription>();
  private invoices = new Map<string, Invoice>();
  private webhookEvents = new Map<string, WebhookEvent>();

  saveSubscription(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, {
      ...subscription,
    });
  }

  findSubscription(id: string): Subscription | undefined {
    const subscription = this.subscriptions.get(id);

    return subscription ? { ...subscription } : undefined;
  }

  saveInvoice(invoice: Invoice): void {
    this.invoices.set(invoice.id, {
      ...invoice,
    });
  }

  findInvoice(id: string): Invoice | undefined {
    const invoice = this.invoices.get(id);

    return invoice ? { ...invoice } : undefined;
  }

  findInvoicesBySubscription(subscriptionId: string): Invoice[] {
    return [...this.invoices.values()]
      .filter((invoice) => invoice.subscriptionId === subscriptionId)
      .map((invoice) => ({ ...invoice }));
  }

  saveWebhookEvent(event: WebhookEvent): void {
    this.webhookEvents.set(event.eventId, {
      ...event,
    });
  }

  findWebhookEvent(eventId: string): WebhookEvent | undefined {
    const event = this.webhookEvents.get(eventId);

    return event ? { ...event } : undefined;
  }

  getWebhookEventCount(): number {
    return this.webhookEvents.size;
  }

  clear(): void {
    this.subscriptions.clear();
    this.invoices.clear();
    this.webhookEvents.clear();
  }
}
