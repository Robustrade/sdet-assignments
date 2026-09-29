import type { ChargeRequest } from '../../../src/provider/PaymentProvider';

export type WebhookType = 'payment.succeeded' | 'payment.failed' | 'payment.refunded';

let eventSeq = 0;

/**
 * Builds provider webhook payloads. The usual entry point is forCharge(), which echoes
 * exactly what the mock provider was asked to charge — the same way a real provider
 * would — so tests never have to dig invoice IDs out of the database.
 */
export class WebhookEventBuilder {
  private readonly payload: Record<string, unknown> = {
    event_id: `evt_test_${++eventSeq}`,
    type: 'payment.succeeded',
    subscription_id: 'sub_unset',
    invoice_id: 'inv_unset',
    amount: 0,
    currency: 'USD',
  };

  paymentSucceeded(): this {
    return this.ofType('payment.succeeded');
  }

  paymentFailed(): this {
    return this.ofType('payment.failed');
  }

  refunded(): this {
    return this.ofType('payment.refunded');
  }

  /** Accepts any string so tests can send unknown event types. */
  ofType(type: WebhookType | (string & {})): this {
    this.payload.type = type;
    return this;
  }

  forCharge(charge: ChargeRequest): this {
    this.payload.subscription_id = charge.metadata.subscriptionId;
    this.payload.invoice_id = charge.metadata.invoiceId;
    this.payload.amount = charge.amount;
    this.payload.currency = charge.currency;
    return this;
  }

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  with(field: string, value: unknown): this {
    this.payload[field] = value;
    return this;
  }

  without(field: string): this {
    delete this.payload[field];
    return this;
  }

  build(): Record<string, unknown> {
    return structuredClone(this.payload);
  }
}

export const aWebhook = () => new WebhookEventBuilder();
