class InMemorySubscriptionRepository {
  constructor() {
    this.rows = new Map();
  }

  save(subscription) {
    this.rows.set(subscription.id, { ...subscription });
    return this.getById(subscription.id);
  }

  getById(id) {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  all() {
    return Array.from(this.rows.values()).map((x) => ({ ...x }));
  }
}

class InMemoryInvoiceRepository {
  constructor() {
    this.rows = [];
  }

  add(invoice) {
    this.rows.push({ ...invoice });
    return { ...invoice };
  }

  findByInvoiceId(invoiceId) {
    return this.rows
      .filter((x) => x.invoiceId === invoiceId)
      .map((x) => ({ ...x }));
  }

  findBySubscriptionId(subscriptionId) {
    return this.rows
      .filter((x) => x.subscriptionId === subscriptionId)
      .map((x) => ({ ...x }));
  }

  all() {
    return this.rows.map((x) => ({ ...x }));
  }
}

class InMemoryWebhookEventRepository {
  constructor() {
    this.rows = [];
    this.processedIds = new Set();
  }

  hasProcessed(eventId) {
    return this.processedIds.has(eventId);
  }

  markProcessed(eventId) {
    this.processedIds.add(eventId);
  }

  add(eventRow) {
    this.rows.push({ ...eventRow });
  }

  all() {
    return this.rows.map((x) => ({ ...x }));
  }
}

class InMemoryAuditLogRepository {
  constructor() {
    this.rows = [];
  }

  add(entry) {
    this.rows.push({ ...entry });
  }

  findBySubscriptionId(subscriptionId) {
    return this.rows
      .filter((x) => x.subscriptionId === subscriptionId)
      .map((x) => ({ ...x }));
  }

  all() {
    return this.rows.map((x) => ({ ...x }));
  }
}

module.exports = {
  InMemorySubscriptionRepository,
  InMemoryInvoiceRepository,
  InMemoryWebhookEventRepository,
  InMemoryAuditLogRepository,
};
