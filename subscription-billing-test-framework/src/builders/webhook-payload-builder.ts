import { randomUUID } from 'crypto';

export class WebhookPayloadBuilder {
  private payload = {
    event_id: `evt_${randomUUID().substring(0, 8)}`,
    type: 'payment.succeeded',
    subscription_id: 'sub_001',
    invoice_id: `inv_${randomUUID().substring(0, 8)}`,
    amount: 4900,
    currency: 'USD',
  };

  public withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  public withType(type: string): this {
    this.payload.type = type;
    return this;
  }

  public withSubscriptionId(subId: string): this {
    this.payload.subscription_id = subId;
    return this;
  }

  public withAmount(amount: number): this {
    this.payload.amount = amount;
    return this;
  }

  public build() {
    return { ...this.payload };
  }
}