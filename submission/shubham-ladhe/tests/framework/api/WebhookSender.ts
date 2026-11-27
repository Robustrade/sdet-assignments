import type { Server } from 'http';
import request from 'supertest';
import { Invoice } from '../../../src/domain/types';
import { WebhookSignature } from '../../../src/services/WebhookSignature';
import { aWebhook, WebhookEventBuilder } from '../builders';
import { ErrorBody, errorContract, WebhookReceiptBody, webhookReceiptContract } from './contracts';
import { ContractViolation } from './SubscriptionApiClient';

export type SignatureMode =
  | 'valid'
  | 'missing'
  /** Signed with a secret the service doesn't know (a forger). */
  | 'wrong-secret'
  /** Validly signed, then the body is altered in transit. */
  | 'tampered'
  | { header: string };

export type WebhookResult =
  | { ok: true; status: number; body: WebhookReceiptBody }
  | { ok: false; status: number; body: ErrorBody };

/** Plays the payment provider's side of webhook delivery (inbound to the service). */
export class WebhookSender {
  private readonly signer: WebhookSignature;
  private readonly forger = new WebhookSignature('not-the-shared-secret');

  constructor(
    private readonly server: Server,
    secret: string,
    private readonly findInvoice: (invoiceId: string) => Invoice | undefined,
  ) {
    this.signer = new WebhookSignature(secret);
  }

  /** A webhook builder already pointed at one of our invoices (ids and amount filled in). */
  about(invoiceId: string): WebhookEventBuilder {
    const invoice = this.findInvoice(invoiceId);
    if (!invoice) throw new Error(`No invoice ${invoiceId} to build a webhook for`);
    return aWebhook().forInvoice(invoice);
  }

  send(event: WebhookEventBuilder | object, signature: SignatureMode = 'valid'): Promise<WebhookResult> {
    const payload = event instanceof WebhookEventBuilder ? event.build() : event;
    return this.sendRaw(JSON.stringify(payload), signature);
  }

  async sendRaw(rawBody: string, signature: SignatureMode = 'valid'): Promise<WebhookResult> {
    const { body, header } = this.sign(rawBody, signature);

    let req = request(this.server).post('/webhooks/payment-provider').set('Content-Type', 'application/json');
    if (header !== undefined) req = req.set('X-Provider-Signature', header);
    const response = await req.send(body);

    if (response.status === 200) {
      const parsed = webhookReceiptContract.safeParse(response.body);
      if (!parsed.success) throw new ContractViolation('POST /webhooks/payment-provider', parsed.error.issues, response.body);
      return { ok: true, status: response.status, body: parsed.data };
    }
    const parsed = errorContract.safeParse(response.body);
    if (!parsed.success) throw new ContractViolation('POST /webhooks/payment-provider (error)', parsed.error.issues, response.body);
    return { ok: false, status: response.status, body: parsed.data };
  }

  private sign(rawBody: string, mode: SignatureMode): { body: string; header?: string } {
    if (mode === 'valid') return { body: rawBody, header: this.signer.sign(rawBody) };
    if (mode === 'missing') return { body: rawBody };
    if (mode === 'wrong-secret') return { body: rawBody, header: this.forger.sign(rawBody) };
    if (mode === 'tampered') {
      const altered = rawBody.replace(/"amount":(\d+)/, (_match, amount: string) => `"amount":${Number(amount) + 1}`);
      return { body: altered === rawBody ? `${rawBody} ` : altered, header: this.signer.sign(rawBody) };
    }
    return { body: rawBody, header: mode.header };
  }
}
