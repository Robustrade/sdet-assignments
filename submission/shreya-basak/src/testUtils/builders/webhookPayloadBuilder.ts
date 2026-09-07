import { randomUUID } from 'crypto';
import { WebhookEventType } from '../../domain/types';
import { signPayload } from '../../webhooks/signature';

interface RawWebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export class WebhookPayloadBuilder {
  private eventId = `evt_${randomUUID().slice(0, 8)}`;
  private type: WebhookEventType = 'payment.succeeded';
  private subscriptionId = 'sub_placeholder';
  private invoiceId = `inv_${randomUUID().slice(0, 8)}`;
  private amount = 4900;
  private currency = 'USD';

  withEventId(id: string): this {
    this.eventId = id;
    return this;
  }

  withInvoiceId(id: string): this {
    this.invoiceId = id;
    return this;
  }

  ofType(type: WebhookEventType): this {
    this.type = type;
    return this;
  }

  forSubscription(id: string): this {
    this.subscriptionId = id;
    return this;
  }

  withAmount(amount: number): this {
    this.amount = amount;
    return this;
  }

  private payload(): RawWebhookPayload {
    return {
      event_id: this.eventId,
      type: this.type,
      subscription_id: this.subscriptionId,
      invoice_id: this.invoiceId,
      amount: this.amount,
      currency: this.currency,
    };
  }

  buildSigned(): { rawBody: string; signature: string; payload: RawWebhookPayload } {
    const payload = this.payload();
    const rawBody = JSON.stringify(payload);
    return { rawBody, signature: signPayload(rawBody), payload };
  }

  buildWithInvalidSignature(): { rawBody: string; signature: string; payload: RawWebhookPayload } {
    const payload = this.payload();
    const rawBody = JSON.stringify(payload);
    return { rawBody, signature: 'deadbeef'.repeat(8), payload };
  }

  buildMalformedButSigned(
    omitField: keyof RawWebhookPayload,
  ): { rawBody: string; signature: string } {
    const payload: Partial<RawWebhookPayload> = { ...this.payload() };
    delete payload[omitField];
    const rawBody = JSON.stringify(payload);
    return { rawBody, signature: signPayload(rawBody) };
  }
}
