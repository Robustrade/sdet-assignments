import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CreateSubscription, Subscription, Invoice, WebhookEvent } from '../../src/domain.ts';

export interface ApiResult<T> { status: number; body: T; }
export interface BillingResult { subscription: Subscription; invoice: Invoice | null; }
export class HttpClient {
  constructor(private readonly server: Server) {}
  async send<T>(method: string, path: string, body?: string, headers: Record<string,string> = {}): Promise<ApiResult<T>> {
    const port = (this.server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method, body, headers: {'Content-Type':'application/json', ...headers},
      signal: AbortSignal.timeout(5000),
    });
    return {status: response.status, body: await response.json() as T};
  }
}
export class SubscriptionApiClient {
  constructor(readonly http: HttpClient) {}
  create(data: CreateSubscription) { return this.http.send<BillingResult>('POST','/subscriptions',JSON.stringify(data)); }
  get(id: string) { return this.http.send<Subscription>('GET',`/subscriptions/${id}`); }
  cancel(id: string) { return this.http.send<Subscription>('POST',`/subscriptions/${id}/cancel`); }
  bill(id: string) { return this.http.send<BillingResult>('POST',`/subscriptions/${id}/bill`); }
  changePlan(id: string, plan: string) {
    return this.http.send<Subscription>('POST',`/subscriptions/${id}/plan`,JSON.stringify({plan}));
  }
  malformedCreation() { return this.http.send<{error:string}>('POST','/subscriptions','{'); }
}
export class WebhookSimulator {
  constructor(private readonly http: HttpClient, private readonly secret: string) {}
  sign(raw: string): string { return createHmac('sha256', this.secret).update(raw).digest('hex'); }
  deliver(event: WebhookEvent) { return this.raw(JSON.stringify(event)); }
  raw(raw: string, signature: string | null = this.sign(raw)) {
    return this.http.send<{outcome?:string; error?:string}>('POST','/webhooks/payment-provider',raw,
      signature === null ? {} : {'X-Provider-Signature':signature});
  }
}
