class WebhookEventBuilder {
  constructor() {
    this.payload = {
      event_id: 'evt_001',
      type: 'payment.succeeded',
      subscription_id: 'sub_001',
      invoice_id: 'inv_001',
      amount: 4900,
      currency: 'USD',
    };
  }

  withEventId(eventId) {
    this.payload.event_id = eventId;
    return this;
  }

  withType(type) {
    this.payload.type = type;
    return this;
  }

  withSubscriptionId(subscriptionId) {
    this.payload.subscription_id = subscriptionId;
    return this;
  }

  withInvoiceId(invoiceId) {
    this.payload.invoice_id = invoiceId;
    return this;
  }

  withAmount(amount) {
    this.payload.amount = amount;
    return this;
  }

  build() {
    return { ...this.payload };
  }
}

module.exports = {
  WebhookEventBuilder,
};
