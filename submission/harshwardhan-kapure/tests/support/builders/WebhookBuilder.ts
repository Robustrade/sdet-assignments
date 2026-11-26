import crypto from 'node:crypto';
import { DEFAULT_WEBHOOK_SECRET, signWebhookPayload } from '../../../src/signature';
import { WebhookEventType, WebhookPayload } from '../../../src/types';

export interface BuiltWebhookRequest {
  rawBody: string;
  headers: Record<string, string>;
  payload?: WebhookPayload;
}

/**
 * Fluent builder for signed, unsigned, forged, and malformed webhook HTTP requests.
 */
export class WebhookBuilder {
  private eventId = `evt_${crypto.randomUUID().slice(0, 8)}`;
  private type: WebhookEventType = 'payment.succeeded';
  private subscriptionId = 'sub_001';
  private invoiceId = `inv_wh_${crypto.randomUUID().slice(0, 8)}`;
  private amount = 4900;
  private currency = 'USD';
  private secret = DEFAULT_WEBHOOK_SECRET;

  withEventId(eventId: string): this {
    this.eventId = eventId;
    return this;
  }

  paymentSucceeded(): this {
    this.type = 'payment.succeeded';
    return this;
  }

  paymentFailed(): this {
    this.type = 'payment.failed';
    return this;
  }

  paymentRefunded(): this {
    this.type = 'payment.refunded';
    return this;
  }

  forSubscription(subscriptionId: string): this {
    this.subscriptionId = subscriptionId;
    return this;
  }

  forInvoice(invoiceId: string): this {
    this.invoiceId = invoiceId;
    return this;
  }

  withAmount(amount: number): this {
    this.amount = amount;
    return this;
  }

  withCurrency(currency: string): this {
    this.currency = currency;
    return this;
  }

  withSecret(secret: string): this {
    this.secret = secret;
    return this;
  }

  buildPayload(): WebhookPayload {
    return {
      event_id: this.eventId,
      type: this.type,
      subscription_id: this.subscriptionId,
      invoice_id: this.invoiceId,
      amount: this.amount,
      currency: this.currency
    };
  }

  signed(): BuiltWebhookRequest {
    const payload = this.buildPayload();
    const rawBody = JSON.stringify(payload);
    return {
      rawBody,
      headers: {
        'X-Provider-Signature': signWebhookPayload(rawBody, this.secret)
      },
      payload
    };
  }

  unsigned(): BuiltWebhookRequest {
    const payload = this.buildPayload();
    return {
      rawBody: JSON.stringify(payload),
      headers: {},
      payload
    };
  }

  forged(badSignature = 'deadbeef'.repeat(8)): BuiltWebhookRequest {
    const payload = this.buildPayload();
    return {
      rawBody: JSON.stringify(payload),
      headers: {
        'X-Provider-Signature': badSignature
      },
      payload
    };
  }

  malformed(rawBody = '{not-valid-json'): BuiltWebhookRequest {
    return {
      rawBody,
      headers: {
        'X-Provider-Signature': signWebhookPayload(rawBody, this.secret)
      }
    };
  }
}

export function aWebhook(): WebhookBuilder {
  return new WebhookBuilder();
}
