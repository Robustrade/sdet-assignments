import request from 'supertest';
import { BillingRepository, type ChargeRequest, type ChargeResult, type PaymentProvider } from '../src/domain.js';
import { SubscriptionRequestBuilder, WebhookBuilder } from '../src/builders.js';
import { createBillingApp, sign } from '../src/service.js';

export class RecordingPaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  next: ChargeResult = { outcome: 'success', reference: 'pay_test_1' };
  async charge(input: ChargeRequest) { this.calls.push({ ...input }); return { ...this.next }; }
}

export class ApiClient {
  constructor(private readonly app: ReturnType<typeof createBillingApp>) {}
  create(body = new SubscriptionRequestBuilder().build()) { return request(this.app).post('/subscriptions').send(body); }
  get(id: string) { return request(this.app).get(`/subscriptions/${id}`); }
  cancel(id: string) { return request(this.app).post(`/subscriptions/${id}/cancel`); }
  charge(id: string) { return request(this.app).post(`/subscriptions/${id}/charge`); }
  webhook(payload: object) {
    const raw = JSON.stringify(payload);
    return request(this.app).post('/webhooks/payment-provider').set('Content-Type', 'application/json').set('X-Provider-Signature', sign(raw)).send(raw);
  }
}

export class BillingFixture {
  readonly repository = new BillingRepository();
  readonly provider = new RecordingPaymentProvider();
  readonly app = createBillingApp(this.repository, this.provider);
  readonly api = new ApiClient(this.app);
  subscription() { return this.api.create(new SubscriptionRequestBuilder().build()); }
  webhook(id: string, type = 'payment.succeeded', invoice = 'inv_webhook', eventId = 'evt_1') {
    return this.api.webhook(new WebhookBuilder().eventId(eventId).type(type).subscription(id).invoice(invoice).build());
  }
}
