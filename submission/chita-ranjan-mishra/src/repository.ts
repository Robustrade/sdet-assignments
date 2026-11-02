import type {
  AuditRecord,
  Invoice,
  SubscriptionData,
  WebhookDeliveryRecord,
  WebhookEventRecord,
} from "./domain.js";

export interface BillingRepository {
  addCustomer(customerId: string): void;
  hasCustomer(customerId: string): boolean;
  addSubscription(subscription: SubscriptionData): void;
  getSubscription(subscriptionId: string): SubscriptionData | undefined;
  saveSubscription(subscription: SubscriptionData): void;
  getSubscriptions(): SubscriptionData[];
  addInvoice(invoice: Invoice): void;
  getInvoice(invoiceId: string): Invoice | undefined;
  saveInvoice(invoice: Invoice): void;
  getInvoicesForSubscription(subscriptionId: string): Invoice[];
  getInvoices(): Invoice[];
  claimWebhook(event: WebhookEventRecord): boolean;
  getWebhookEvent(eventId: string): WebhookEventRecord | undefined;
  saveWebhookEvent(event: WebhookEventRecord): void;
  recordWebhookDelivery(delivery: WebhookDeliveryRecord): void;
  getWebhookDeliveries(eventId: string): WebhookDeliveryRecord[];
  addAuditRecord(record: AuditRecord): void;
  getAuditRecords(subscriptionId: string): AuditRecord[];
}

export class InMemoryBillingRepository implements BillingRepository {
  private readonly customers = new Set<string>();
  private readonly subscriptions = new Map<string, SubscriptionData>();
  private readonly invoices = new Map<string, Invoice>();
  private readonly webhookEvents = new Map<string, WebhookEventRecord>();
  private readonly webhookDeliveries: WebhookDeliveryRecord[] = [];
  private readonly auditRecords: AuditRecord[] = [];

  addCustomer(customerId: string): void {
    this.customers.add(customerId);
  }

  hasCustomer(customerId: string): boolean {
    return this.customers.has(customerId);
  }

  addSubscription(subscription: SubscriptionData): void {
    if (this.subscriptions.has(subscription.id)) {
      throw new Error(`Subscription already exists: ${subscription.id}`);
    }
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  getSubscription(subscriptionId: string): SubscriptionData | undefined {
    const subscription = this.subscriptions.get(subscriptionId);
    return subscription ? { ...subscription } : undefined;
  }

  saveSubscription(subscription: SubscriptionData): void {
    if (!this.subscriptions.has(subscription.id)) {
      throw new Error(`Subscription does not exist: ${subscription.id}`);
    }
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  getSubscriptions(): SubscriptionData[] {
    return [...this.subscriptions.values()].map((subscription) => ({
      ...subscription,
    }));
  }

  addInvoice(invoice: Invoice): void {
    if (this.invoices.has(invoice.id)) {
      throw new Error(`Invoice already exists: ${invoice.id}`);
    }
    this.invoices.set(invoice.id, { ...invoice });
  }

  getInvoice(invoiceId: string): Invoice | undefined {
    const invoice = this.invoices.get(invoiceId);
    return invoice ? { ...invoice } : undefined;
  }

  saveInvoice(invoice: Invoice): void {
    if (!this.invoices.has(invoice.id)) {
      throw new Error(`Invoice does not exist: ${invoice.id}`);
    }
    this.invoices.set(invoice.id, { ...invoice });
  }

  getInvoicesForSubscription(subscriptionId: string): Invoice[] {
    return [...this.invoices.values()]
      .filter((invoice) => invoice.subscriptionId === subscriptionId)
      .map((invoice) => ({ ...invoice }));
  }

  getInvoices(): Invoice[] {
    return [...this.invoices.values()].map((invoice) => ({ ...invoice }));
  }

  claimWebhook(event: WebhookEventRecord): boolean {
    if (this.webhookEvents.has(event.eventId)) {
      return false;
    }
    this.webhookEvents.set(event.eventId, { ...event });
    return true;
  }

  getWebhookEvent(eventId: string): WebhookEventRecord | undefined {
    const event = this.webhookEvents.get(eventId);
    return event ? { ...event } : undefined;
  }

  saveWebhookEvent(event: WebhookEventRecord): void {
    if (!this.webhookEvents.has(event.eventId)) {
      throw new Error(`Webhook event does not exist: ${event.eventId}`);
    }
    this.webhookEvents.set(event.eventId, { ...event });
  }

  recordWebhookDelivery(delivery: WebhookDeliveryRecord): void {
    this.webhookDeliveries.push({ ...delivery });
  }

  getWebhookDeliveries(eventId: string): WebhookDeliveryRecord[] {
    return this.webhookDeliveries
      .filter((delivery) => delivery.eventId === eventId)
      .map((delivery) => ({ ...delivery }));
  }

  addAuditRecord(record: AuditRecord): void {
    this.auditRecords.push({ ...record });
  }

  getAuditRecords(subscriptionId: string): AuditRecord[] {
    return this.auditRecords
      .filter((record) => record.subscriptionId === subscriptionId)
      .map((record) => ({ ...record }));
  }
}
