/** In-memory persistence adapter. A fresh instance is created for every test. */
export class InMemoryRepository {
  constructor() {
    this.customers = new Set(['cust_001', 'cust_007', 'cust_998']);
    this.subscriptions = new Map();
    this.invoices = new Map();
    // event_id -> durable processing record (including ignored/duplicate deliveries)
    this.webhookEvents = new Map();
    this.auditLog = [];
    this.subscriptionCounter = 1;
    this.invoiceCounter = 1;
  }

  addCustomer(customerId) { this.customers.add(customerId); }
  hasCustomer(customerId) { return this.customers.has(customerId); }
  nextSubscriptionId() { return `sub_${this.subscriptionCounter++}`; }
  nextInvoiceId() { return `inv_${this.invoiceCounter++}`; }

  addSubscription(subscription) {
    if (this.subscriptions.has(subscription.id)) throw new Error(`Subscription ${subscription.id} already exists`);
    this.subscriptions.set(subscription.id, structuredClone(subscription));
  }
  getSubscription(id) {
    const value = this.subscriptions.get(id);
    return value ? structuredClone(value) : null;
  }
  updateSubscription(subscription) {
    if (!this.subscriptions.has(subscription.id)) throw new Error(`Subscription ${subscription.id} not found`);
    this.subscriptions.set(subscription.id, structuredClone(subscription));
  }

  hasProcessedEvent(eventId) { return this.webhookEvents.has(eventId); }
  getEvent(eventId) {
    const value = this.webhookEvents.get(eventId);
    return value ? structuredClone(value) : null;
  }
  recordWebhookEvent(event) {
    this.webhookEvents.set(event.event_id, structuredClone(event));
  }
  incrementDuplicateDelivery(eventId) {
    const event = this.webhookEvents.get(eventId);
    if (event) {
      event.delivery_count += 1;
      event.duplicate_count += 1;
    }
  }

  getInvoice(id) {
    const value = this.invoices.get(id);
    return value ? structuredClone(value) : null;
  }
  addInvoice(invoice) {
    if (this.invoices.has(invoice.id)) throw new Error(`Invoice ${invoice.id} already exists`);
    this.invoices.set(invoice.id, structuredClone(invoice));
  }
  updateInvoice(invoice) {
    if (!this.invoices.has(invoice.id)) throw new Error(`Invoice ${invoice.id} not found`);
    this.invoices.set(invoice.id, structuredClone(invoice));
  }
  invoicesForSubscription(subscriptionId) {
    return [...this.invoices.values()]
      .filter(invoice => invoice.subscription_id === subscriptionId)
      .map(value => structuredClone(value));
  }
  recordAudit(subscriptionId, event, detail = {}) {
    this.auditLog.push({ subscription_id: subscriptionId, event, detail: structuredClone(detail), created_at: new Date().toISOString() });
  }
  getAuditLog(subscriptionId) {
    return this.auditLog.filter(entry => entry.subscription_id === subscriptionId).map(value => structuredClone(value));
  }
}
