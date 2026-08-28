const crypto = require('crypto');

class SubscriptionBuilder {
  constructor() {
    this.data = { customer_id: 'cust_001', plan: 'pro', payment_method_id: 'pm_test_visa_4242' };
  }

  withPlan(plan) { this.data.plan = plan; return this; }
  withCustomer(customerId) { this.data.customer_id = customerId; return this; }
  build() { return { ...this.data }; }
}

class WebhookBuilder {
  constructor(subscriptionId, overrides = {}) {
    this.data = {
      event_id: `evt_${Date.now()}_${Math.random()}`,
      type: 'payment.succeeded',
      subscription_id: subscriptionId,
      invoice_id: `inv_${Date.now()}`,
      amount: 4900,
      currency: 'USD',
      ...overrides
    };
  }

  withEventId(eventId) { this.data.event_id = eventId; return this; }
  withType(type) { this.data.type = type; return this; }
  withInvoice(invoiceId) { this.data.invoice_id = invoiceId; return this; }
  build() { return { ...this.data }; }
}

class SubscriptionApiClient {
  constructor(request) {
    this.request = request;
  }

  reset() { return this.request.post('/api/_test/reset'); }
  configureProvider(outcome) { return this.request.post('/api/_test/provider', { data: { outcome } }); }
  create(data) { return this.request.post('/api/subscriptions', { data }); }
  get(id) { return this.request.get(`/api/subscriptions/${id}`); }
  cancel(id) { return this.request.post(`/api/subscriptions/${id}/cancel`); }
  changePlan(id, plan) { return this.request.patch(`/api/subscriptions/${id}/plan`, { data: { plan } }); }
  charge(id) { return this.request.post(`/api/subscriptions/${id}/charge`); }
  state(id) { return this.request.get(`/api/_test/state/${id}`); }

  webhook(payload, secret = 'assignment-secret') {
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return this.request.post('/api/subscriptions/webhooks/payment-provider', {
      data: body,
      headers: { 'Content-Type': 'application/json', 'X-Provider-Signature': signature }
    });
  }
}

class BillingAssertions {
  static async stateMatches(response, status, invoiceCount) {
    const state = await response.json();
    if (state.subscription.status !== status) throw new Error(`Expected ${status}, got ${state.subscription.status}`);
    if (state.invoices.length !== invoiceCount) throw new Error(`Expected ${invoiceCount} invoices, got ${state.invoices.length}`);
    return state;
  }
}

module.exports = { BillingAssertions, SubscriptionApiClient, SubscriptionBuilder, WebhookBuilder };