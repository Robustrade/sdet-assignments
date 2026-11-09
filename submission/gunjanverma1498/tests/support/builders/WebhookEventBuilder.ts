import type { WebhookEventType } from '../../../src/domain/types';
import { signPayload } from '../../../src/payments/signature';

export interface SignedWebhook {
  /** Exact JSON bytes to send as the request body (what the signature covers). */
  rawBody: string;
  /** Signature header value, or undefined to send the request unsigned. */
  signature: string | undefined;
}

/**
 * Builder for inbound webhook events.
 *
 * Produces the raw body + a valid HMAC signature over those exact bytes, and
 * offers named mutators for the failure paths the suite must cover:
 * `unsigned()`, `withTamperedSignature()`, and `malformedBody()`. Because the
 * body and signature are built together, a valid event is valid by construction
 * and the invalid variants are unmistakable in the test.
 */
export class WebhookEventBuilder {
  private payload: Record<string, unknown> = {
    event_id: 'evt_default',
    type: 'payment.succeeded',
    subscription_id: 'sub_default',
    invoice_id: 'inv_default',
    amount: 4900,
    currency: 'USD',
  };

  private signed = true;
  private tamper = false;
  private malformed = false;

  constructor(private readonly secret: string) {}

  static anEvent(secret: string): WebhookEventBuilder {
    return new WebhookEventBuilder(secret);
  }

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  ofType(type: WebhookEventType): this {
    this.payload.type = type;
    return this;
  }

  forSubscription(subscriptionId: string): this {
    this.payload.subscription_id = subscriptionId;
    return this;
  }

  forInvoice(invoiceId: string): this {
    this.payload.invoice_id = invoiceId;
    return this;
  }

  withAmount(amount: number): this {
    this.payload.amount = amount;
    return this;
  }

  withCurrency(currency: string): this {
    this.payload.currency = currency;
    return this;
  }

  /** Remove a required field to exercise malformed-payload handling. */
  without(field: keyof typeof this.payload | string): this {
    delete this.payload[field as string];
    return this;
  }

  /** Send no signature header at all. */
  unsigned(): this {
    this.signed = false;
    return this;
  }

  /** Send a present-but-wrong signature. */
  withTamperedSignature(): this {
    this.tamper = true;
    return this;
  }

  /** Send a body that is not valid JSON. */
  malformedBody(): this {
    this.malformed = true;
    return this;
  }

  build(): SignedWebhook {
    const rawBody = this.malformed ? '{not-json' : JSON.stringify(this.payload);
    if (!this.signed) {
      return { rawBody, signature: undefined };
    }
    const signature = this.tamper
      ? signPayload(rawBody, `${this.secret}-wrong`)
      : signPayload(rawBody, this.secret);
    return { rawBody, signature };
  }
}
