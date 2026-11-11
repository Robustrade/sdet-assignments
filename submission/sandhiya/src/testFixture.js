import { createHmac } from 'node:crypto';
import { PlanCatalog } from './planCatalog.js';
import { SubscriptionStateMachine } from './subscriptionStateMachine.js';
import { InMemoryRepository } from './inMemoryRepository.js';
import { MockPaymentProvider } from './paymentProvider.js';
import { SubscriptionService } from './subscriptionService.js';
import { createHttpServer } from './httpServer.js';

export class HttpApiClient {
  constructor(baseUrl) { this.baseUrl = baseUrl; }
  async request(method, path, payload, headers = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...headers },
      body: payload === undefined ? undefined : (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    });
    const raw = await response.text();
    let body = raw;
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* preserve raw response */ }
    return { status: response.status, body, raw };
  }
  createSubscription(payload) { return this.request('POST', '/subscriptions', payload); }
  getSubscription(id) { return this.request('GET', `/subscriptions/${id}`); }
  cancelSubscription(id) { return this.request('POST', `/subscriptions/${id}/cancel`); }
  postWebhook(payload, signature) { return this.request('POST', '/webhooks/payment-provider', payload, { 'X-Provider-Signature': signature }); }
}

export class SubscriptionBuilder {
  constructor() { this.data = { customer_id: 'cust_001', plan: 'pro', payment_method_id: 'pm_test_visa_4242' }; }
  withCustomerId(value) { this.data.customer_id = value; return this; }
  withPlan(value) { this.data.plan = value; return this; }
  withPaymentMethod(value) { this.data.payment_method_id = value; return this; }
  build() { return { ...this.data }; }
}

export class WebhookBuilder {
  static build({ type, subscriptionId, eventId, invoiceId, amount = 4900, currency = 'USD' }) {
    return { event_id: eventId, type, subscription_id: subscriptionId, invoice_id: invoiceId, amount, currency };
  }
  static success(options) { return this.build({ ...options, type: 'payment.succeeded' }); }
  static failed(options) { return this.build({ ...options, type: 'payment.failed' }); }
  static refunded(options) { return this.build({ ...options, type: 'payment.refunded' }); }
}

export class BillingTestFixture {
  constructor({ secret = 'test-secret', providerOutcomes = [] } = {}) {
    this.secret = secret;
    this.repository = new InMemoryRepository();
    this.planCatalog = new PlanCatalog();
    this.stateMachine = new SubscriptionStateMachine();
    this.paymentProvider = new MockPaymentProvider(providerOutcomes);
    this.service = new SubscriptionService({ repository: this.repository, paymentProvider: this.paymentProvider, planCatalog: this.planCatalog, stateMachine: this.stateMachine });
    this.server = createHttpServer({ service: this.service, webhookSecret: secret });
    this.apiClient = new HttpApiClient('http://127.0.0.1:0');
  }
  async start() {
    await new Promise(resolve => this.server.listen(0, '127.0.0.1', resolve));
    this.apiClient.baseUrl = `http://127.0.0.1:${this.server.address().port}`;
    return this;
  }
  async stop() { await new Promise((resolve, reject) => this.server.close(error => error ? reject(error) : resolve())); }
  createSubscription(payload) { return this.apiClient.createSubscription(payload); }
  getSubscription(id) { return this.apiClient.getSubscription(id); }
  cancelSubscription(id) { return this.apiClient.cancelSubscription(id); }
  sign(raw) { return createHmac('sha256', this.secret).update(raw).digest('hex'); }
  postSignedWebhook(payload) { const raw = JSON.stringify(payload); return this.apiClient.request('POST', '/webhooks/payment-provider', raw, { 'X-Provider-Signature': this.sign(raw) }); }
  makeWebhookFailure(payload) { const raw = JSON.stringify(payload); return this.apiClient.request('POST', '/webhooks/payment-provider', raw, { 'X-Provider-Signature': `${this.sign(raw)}x` }); }
  completeTrial(subscriptionId) { return this.service.completeTrial(subscriptionId); }
}
