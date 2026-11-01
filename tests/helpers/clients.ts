import { APIRequestContext, APIResponse } from '@playwright/test';
import { createHmac } from 'crypto';

export interface Result { status: number; body: any }

async function toResult(response: Promise<APIResponse>): Promise<Result> {
  const r = await response;
  return { status: r.status(), body: await r.json() };
}

/** Talks to the subscription API. Tests call methods, not raw URLs. */
export class ApiClient {
  constructor(private request: APIRequestContext) {}

  createSubscription(body: object) { return toResult(this.request.post('/subscriptions', { data: body })); }
  createSubscriptionRaw(raw: string) {
    return toResult(this.request.post('/subscriptions', { data: Buffer.from(raw), headers: { 'Content-Type': 'application/json' } }));
  }
  getSubscription(id: string) { return toResult(this.request.get(`/subscriptions/${id}`)); }
  getInvoices(id: string) { return toResult(this.request.get(`/subscriptions/${id}/invoices`)); }
  cancel(id: string) { return toResult(this.request.post(`/subscriptions/${id}/cancel`)); }
  /** Plays the billing scheduler: trial end, renewal or retry. */
  charge(id: string) { return toResult(this.request.post(`/subscriptions/${id}/charge`)); }
}

/**
 * Plays the payment company sending webhooks.
 * It signs with its own crypto code (not the service's), so a bug in the service can't hide itself.
 */
export class WebhookSender {
  constructor(private request: APIRequestContext, private secret: string) {}

  sign(rawBody: string, secret = this.secret) { return createHmac('sha256', secret).update(rawBody).digest('hex'); }

  send(event: object) { const raw = JSON.stringify(event); return this.post(raw, this.sign(raw)); }
  sendWithoutSignature(event: object) { return this.post(JSON.stringify(event), undefined); }
  sendSignedWithWrongSecret(event: object) { const raw = JSON.stringify(event); return this.post(raw, this.sign(raw, 'attacker_secret')); }
  sendRaw(rawBody: string, signature: string | undefined) { return this.post(rawBody, signature); }

  private post(rawBody: string, signature: string | undefined) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (signature) headers['X-Provider-Signature'] = signature;
    // Send raw bytes, so the body is exactly what was signed.
    return toResult(this.request.post('/webhooks/payment-provider', { data: Buffer.from(rawBody), headers }));
  }
}
