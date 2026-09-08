import { AuditEvent, Customer, Invoice, Plan, Subscription, WebhookEvent } from '../domain/models';

export interface Repository {
  reset(): void;
  addCustomer(customer: Customer): void;
  getCustomer(id: string): Customer | undefined;
  addPlan(plan: Plan): void;
  getPlan(code: Plan['code']): Plan | undefined;
  saveSubscription(subscription: Subscription): void;
  getSubscription(id: string): Subscription | undefined;
  saveInvoice(invoice: Invoice): void;
  getInvoice(id: string): Invoice | undefined;
  findInvoiceBySubscription(subscriptionId: string): Invoice | undefined;
  countInvoices(subscriptionId?: string): number;
  saveWebhookEvent(event: WebhookEvent): boolean;
  getWebhookEvent(eventId: string): WebhookEvent | undefined;
  countWebhookEvents(subscriptionId?: string): number;
  addAuditEvent(event: AuditEvent): void;
  getAuditEvents(subscriptionId: string): AuditEvent[];
}

export class InMemoryRepository implements Repository {
  private customers = new Map<string, Customer>();
  private plans = new Map<string, Plan>();
  private subscriptions = new Map<string, Subscription>();
  private invoices = new Map<string, Invoice>();
  private webhookEvents = new Map<string, WebhookEvent>();
  private audits = new Map<string, AuditEvent[]>();

  reset(): void {
    this.customers.clear();
    this.plans.clear();
    this.subscriptions.clear();
    this.invoices.clear();
    this.webhookEvents.clear();
    this.audits.clear();
  }
  addCustomer(customer: Customer): void { this.customers.set(customer.id, customer); }
  getCustomer(id: string): Customer | undefined { return this.customers.get(id); }
  addPlan(plan: Plan): void { this.plans.set(plan.code, plan); }
  getPlan(code: Plan['code']): Plan | undefined { return this.plans.get(code); }
  saveSubscription(subscription: Subscription): void { this.subscriptions.set(subscription.id, structuredClone(subscription)); }
  getSubscription(id: string): Subscription | undefined { const v = this.subscriptions.get(id); return v ? structuredClone(v) : undefined; }
  saveInvoice(invoice: Invoice): void { this.invoices.set(invoice.id, structuredClone(invoice)); }
  getInvoice(id: string): Invoice | undefined { const v = this.invoices.get(id); return v ? structuredClone(v) : undefined; }
  findInvoiceBySubscription(subscriptionId: string): Invoice | undefined {
    return [...this.invoices.values()].find(i => i.subscriptionId === subscriptionId);
  }
  countInvoices(subscriptionId?: string): number {
    return subscriptionId ? [...this.invoices.values()].filter(i => i.subscriptionId === subscriptionId).length : this.invoices.size;
  }
  saveWebhookEvent(event: WebhookEvent): boolean {
    const isNew = !this.webhookEvents.has(event.eventId);
    this.webhookEvents.set(event.eventId, structuredClone(event));
    return isNew;
  }
  getWebhookEvent(eventId: string): WebhookEvent | undefined { const v = this.webhookEvents.get(eventId); return v ? structuredClone(v) : undefined; }
  countWebhookEvents(subscriptionId?: string): number {
    return subscriptionId ? [...this.webhookEvents.values()].filter(e => e.subscriptionId === subscriptionId).length : this.webhookEvents.size;
  }
  addAuditEvent(event: AuditEvent): void {
    const existing = this.audits.get(event.subscriptionId) ?? [];
    existing.push(structuredClone(event));
    this.audits.set(event.subscriptionId, existing);
  }
  getAuditEvents(subscriptionId: string): AuditEvent[] { return structuredClone(this.audits.get(subscriptionId) ?? []); }
}
