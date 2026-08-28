const { v4: uuidv4 } = require('uuid');

class BillingRepository {
  constructor() {
    this.reset();
  }

  reset() {
    this.customers = new Map();
    this.subscriptions = new Map();
    this.invoices = new Map();
    this.webhookEvents = new Map();
    this.auditEvents = [];
  }

  addCustomer(customer) {
    this.customers.set(customer.id, customer);
    return customer;
  }

  getCustomer(id) {
    return this.customers.get(id);
  }

  addSubscription(subscription) {
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  getSubscription(id) {
    return this.subscriptions.get(id);
  }

  updateSubscription(subscription) {
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  addInvoice(invoice) {
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  getInvoice(id) {
    return this.invoices.get(id);
  }

  getInvoicesForSubscription(subscriptionId) {
    return [...this.invoices.values()].filter(invoice => invoice.subscription_id === subscriptionId);
  }

  recordWebhook(event) {
    this.webhookEvents.set(event.event_id, event);
    return event;
  }

  hasWebhook(eventId) {
    return this.webhookEvents.has(eventId);
  }

  addAuditEvent(event) {
    this.auditEvents.push({ id: uuidv4(), ...event });
  }

  getAuditEvents(subscriptionId) {
    return this.auditEvents.filter(event => event.subscription_id === subscriptionId);
  }

  snapshot(subscriptionId) {
    return {
      subscription: this.getSubscription(subscriptionId),
      invoices: this.getInvoicesForSubscription(subscriptionId),
      webhook_events: [...this.webhookEvents.values()],
      audit_events: this.getAuditEvents(subscriptionId)
    };
  }
}

module.exports = BillingRepository;