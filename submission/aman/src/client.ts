import { sign } from './http.ts';
import type { PaymentWebhook } from './domain.ts';
type ApiResponseBody = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class ApiClient {
  private baseUrl: string; private secret: string;
  constructor(baseUrl: string, secret: string) { this.baseUrl = baseUrl; this.secret = secret; }
  async request(method: string, path: string, body?: unknown, headers: Record<string,string> = {}) {
    const response = await fetch(this.baseUrl + path, { method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: response.status, body: await response.json() as ApiResponseBody };
  }
  create(body: unknown) { return this.request('POST', '/subscriptions', body); }
  get(id: string) { return this.request('GET', `/subscriptions/${id}`); }
  cancel(id: string) { return this.request('POST', `/subscriptions/${id}/cancel`); }
  bill(id: string) { return this.request('POST', `/subscriptions/${id}/bill`); }
  retryExhausted(id: string) { return this.request('POST', `/subscriptions/${id}/retry-exhausted`); }
  webhook(payload: PaymentWebhook, signature?: string) {
    const raw = JSON.stringify(payload);
    return this.request('POST', '/webhooks/payment-provider', raw,
      { 'x-provider-signature': signature ?? sign(raw, this.secret) });
  }
}
