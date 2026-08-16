import {
  AuditEvent,
  Payment,
  Subscription,
  WebhookEvent,
} from "../domain/types";

export interface SubscriptionRepository {
  saveSubscription(subscription: Subscription): void;

  findSubscriptionById(id: string): Subscription | undefined;

  savePayment(payment: Payment): void;

  findPaymentByInvoiceId(invoiceId: string): Payment | undefined;

  getPaymentsBySubscriptionId(subscriptionId: string): Payment[];

  saveWebhookEvent(event: WebhookEvent): void;

  hasWebhookEvent(eventId: string): boolean;

  getWebhookEvents(): WebhookEvent[];

  saveAuditEvent(event: AuditEvent): void;

  getAuditEvents(subscriptionId: string): AuditEvent[];
}

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly subscriptions = new Map<string, Subscription>();

  private readonly payments = new Map<string, Payment>();

  private readonly webhookEvents = new Map<string, WebhookEvent>();

  private readonly auditEvents = new Map<string, AuditEvent>();

  saveSubscription(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, structuredClone(subscription));
  }

  findSubscriptionById(id: string): Subscription | undefined {
    const subscription = this.subscriptions.get(id);

    return subscription ? structuredClone(subscription) : undefined;
  }

  savePayment(payment: Payment): void {
    this.payments.set(payment.id, structuredClone(payment));
  }

  findPaymentByInvoiceId(invoiceId: string): Payment | undefined {
    for (const payment of this.payments.values()) {
      if (payment.invoiceId === invoiceId) {
        return structuredClone(payment);
      }
    }

    return undefined;
  }

  getPaymentsBySubscriptionId(subscriptionId: string): Payment[] {
    return Array.from(this.payments.values())
      .filter((payment) => payment.subscriptionId === subscriptionId)
      .map((payment) => structuredClone(payment));
  }

  saveWebhookEvent(event: WebhookEvent): void {
    this.webhookEvents.set(event.eventId, structuredClone(event));
  }

  hasWebhookEvent(eventId: string): boolean {
    return this.webhookEvents.has(eventId);
  }

  getWebhookEvents(): WebhookEvent[] {
    return Array.from(this.webhookEvents.values()).map((event) =>
      structuredClone(event),
    );
  }

  saveAuditEvent(event: AuditEvent): void {
    this.auditEvents.set(event.id, structuredClone(event));
  }

  getAuditEvents(subscriptionId: string): AuditEvent[] {
    return Array.from(this.auditEvents.values())
      .filter((event) => event.subscriptionId === subscriptionId)
      .map((event) => structuredClone(event));
  }
}
