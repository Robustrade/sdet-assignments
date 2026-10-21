/**
 * In-memory persistence layer (Repository pattern).
 *
 * Plays the role of the database: four "tables" (subscriptions, invoices,
 * webhook_events, audit_log) plus seeded customers. The service and the tests
 * only go through these methods, never through the Maps directly.
 * Reads return copies so a test can never mutate stored state by accident.
 */
class BillingRepository {
  constructor() {
    this.customers = new Map();
    this.subscriptions = new Map();
    this.invoices = new Map();
    this.webhookEvents = new Map();
    this.auditLog = [];
    this.sequence = 0;
  }

  nextId(prefix) {
    this.sequence += 1;
    return `${prefix}_${String(this.sequence).padStart(3, '0')}`;
  }

  // customers
  addCustomer(customer) {
    this.customers.set(customer.id, { ...customer });
  }

  findCustomer(id) {
    return copy(this.customers.get(id));
  }

  // subscriptions
  saveSubscription(subscription) {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  findSubscription(id) {
    return copy(this.subscriptions.get(id));
  }

  allSubscriptions() {
    return [...this.subscriptions.values()].map(copy);
  }

  // invoices
  saveInvoice(invoice) {
    this.invoices.set(invoice.id, { ...invoice });
  }

  findInvoice(id) {
    return copy(this.invoices.get(id));
  }

  invoicesFor(subscriptionId) {
    return [...this.invoices.values()].filter((i) => i.subscription_id === subscriptionId).map(copy);
  }

  allInvoices() {
    return [...this.invoices.values()].map(copy);
  }

  // webhook_events (idempotency ledger)
  saveWebhookEvent(event) {
    this.webhookEvents.set(event.event_id, { ...event });
  }

  findWebhookEvent(eventId) {
    return copy(this.webhookEvents.get(eventId));
  }

  webhookEventsFor(subscriptionId) {
    return [...this.webhookEvents.values()].filter((e) => e.subscription_id === subscriptionId).map(copy);
  }

  // audit_log
  addAuditEntry(entry) {
    this.auditLog.push({ ...entry });
  }

  auditFor(subscriptionId) {
    return this.auditLog.filter((e) => e.subscription_id === subscriptionId).map(copy);
  }
}

function copy(row) {
  return row ? { ...row } : null;
}

module.exports = { BillingRepository };
