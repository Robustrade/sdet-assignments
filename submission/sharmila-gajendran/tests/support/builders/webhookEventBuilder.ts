import type { Invoice } from '../../../src/domain/types';

/** The JSON body the payment provider sends. */
export interface WebhookPayload {
  event_id: string;
  type: string;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  failure_reason?: string;
}

let sequence = 0;

/** Builds provider webhook payloads. Every builder gets a new, unique event_id by default. */
export class WebhookEventBuilder {
  private readonly payload: WebhookPayload;

  constructor() {
    sequence += 1;
    this.payload = {
      event_id: `evt_test_${sequence}`,
      type: 'payment.succeeded',
      subscription_id: 'sub_unknown',
      invoice_id: 'inv_unknown',
      amount: 4900,
      currency: 'USD',
    };
  }

  paymentSucceeded(): this {
    this.payload.type = 'payment.succeeded';
    delete this.payload.failure_reason;
    return this;
  }

  paymentFailed(reason = 'card_declined'): this {
    this.payload.type = 'payment.failed';
    this.payload.failure_reason = reason;
    return this;
  }

  paymentRefunded(): this {
    this.payload.type = 'payment.refunded';
    delete this.payload.failure_reason;
    return this;
  }

  /** Takes subscription, invoice, amount and currency from a stored invoice. */
  forInvoice(invoice: Pick<Invoice, 'id' | 'subscriptionId' | 'amountCents' | 'currency'>): this {
    this.payload.subscription_id = invoice.subscriptionId;
    this.payload.invoice_id = invoice.id;
    this.payload.amount = invoice.amountCents;
    this.payload.currency = invoice.currency;
    return this;
  }

  forSubscription(subscriptionId: string): this {
    this.payload.subscription_id = subscriptionId;
    return this;
  }

  forInvoiceId(invoiceId: string): this {
    this.payload.invoice_id = invoiceId;
    return this;
  }

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  build(): WebhookPayload {
    return { ...this.payload };
  }
}

export const aPaymentWebhook = (): WebhookEventBuilder => new WebhookEventBuilder();
