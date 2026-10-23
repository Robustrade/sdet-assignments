import { sign } from './http.ts';
import type { PaymentWebhook } from './domain.ts';
type ApiResponseBody = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class BillingApiClient {
  private baseUrl: string; private secret: string;
  constructor(baseUrl: string, secret: string) { this.baseUrl = baseUrl; this.secret = secret; }
  async sendApiRequest(method: string, path: string, body?: unknown, headers: Record<string,string> = {}) {
    const response = await fetch(this.baseUrl + path, { method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as ApiResponseBody };
  }
  createSubscription(body: unknown) { return this.sendApiRequest('POST', '/subscriptions', body); }
  getSubscriptionById(id: string) { return this.sendApiRequest('GET', `/subscriptions/${id}`); }
  cancelSubscription(id: string) { return this.sendApiRequest('POST', `/subscriptions/${id}/cancel`); }
  attemptSubscriptionCharge(id: string) { return this.sendApiRequest('POST', `/subscriptions/${id}/bill`); }
  markSubscriptionRetriesExhausted(id: string) { return this.sendApiRequest('POST', `/subscriptions/${id}/retry-exhausted`); }
  sendPaymentWebhook(payload: PaymentWebhook, signature?: string) {
    const raw = JSON.stringify(payload);
    return this.sendApiRequest('POST', '/webhooks/payment-provider', raw,
      { 'x-provider-signature': signature ?? sign(raw, this.secret) });
  }
}
