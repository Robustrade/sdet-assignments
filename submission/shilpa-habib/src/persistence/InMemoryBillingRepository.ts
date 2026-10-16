import type { Subscription } from "../domain/Subscription"; import type { Invoice } from "./Invoice"; import type { WebhookEvent } from "./WebhookEvent"; import type { AuditEvent } from "./AuditEvent";
import type { Customer } from "../domain/Customer";

export class InMemoryBillingRepository { private readonly subscriptions = new Map<string, Subscription>(); private readonly invoices = new Map<string, Invoice>(); private readonly webhookEvents = new Map<string, WebhookEvent>(); private readonly auditEvents = new Map<string, AuditEvent>(); private readonly customers = new Map<string, Customer>();

saveCustomer(customer: Customer): void {
  this.customers.set(customer.id, { ...customer });
}

getCustomer(id: string): Customer | undefined {
  const customer = this.customers.get(id);
  return customer ? { ...customer } : undefined;
}

saveSubscription(subscription: Subscription): void { this.subscriptions.set(subscription.id, { ...subscription }); }

getSubscription(id: string): Subscription | undefined { const subscription = this.subscriptions.get(id); return subscription ? { ...subscription } : undefined; }

getAllSubscriptions(): Subscription[] { return Array.from(this.subscriptions.values(), (item) => ({ ...item })); }

saveInvoice(invoice: Invoice): void { this.invoices.set(invoice.id, { ...invoice }); }

getInvoice(id: string): Invoice | undefined { const invoice = this.invoices.get(id); return invoice ? { ...invoice } : undefined; }

getInvoicesForSubscription(subscriptionId: string): Invoice[] { return Array.from(this.invoices.values()) .filter((invoice) => invoice.subscriptionId === subscriptionId) .map((invoice) => ({ ...invoice })); }

saveWebhookEvent(event: WebhookEvent): void { this.webhookEvents.set(event.eventId, { ...event }); }

getWebhookEvent(eventId: string): WebhookEvent | undefined { const event = this.webhookEvents.get(eventId); return event ? { ...event } : undefined; }

getAllWebhookEvents(): WebhookEvent[] { return Array.from(this.webhookEvents.values(), (event) => ({ ...event })); }

saveAuditEvent(event: AuditEvent): void { this.auditEvents.set(event.id, { ...event }); }

getAuditEventsForSubscription(subscriptionId: string): AuditEvent[] { return Array.from(this.auditEvents.values()) .filter((event) => event.subscriptionId === subscriptionId) .map((event) => ({ ...event })); }

clear(): void { this.subscriptions.clear(); this.invoices.clear(); this.webhookEvents.clear(); this.auditEvents.clear(); this.customers.clear(); } }