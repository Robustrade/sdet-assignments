/**
 * Builder for the JSON body of a provider webhook. Defaults to a valid `payment.succeeded` for the
 * seeded subscription/invoice; each invalid payload is one deliberate deviation.
 * The result is a plain object (the wire format), not a domain type, so malformed shapes can be built.
 */
export class WebhookEventBuilder {
  private fields: Record<string, unknown> = {
    event_id: 'evt_001',
    type: 'payment.succeeded',
    subscription_id: 'sub_seed_001',
    invoice_id: 'inv_seed_001',
    amount: 4900,
    currency: 'USD',
  };

  succeeded(): this {
    return this.with('type', 'payment.succeeded');
  }

  failed(): this {
    return this.with('type', 'payment.failed');
  }

  refunded(): this {
    return this.with('type', 'payment.refunded');
  }

  withId(eventId: unknown): this {
    return this.with('event_id', eventId);
  }

  forSubscription(subscriptionId: unknown): this {
    return this.with('subscription_id', subscriptionId);
  }

  forInvoice(invoiceId: unknown): this {
    return this.with('invoice_id', invoiceId);
  }

  withAmount(amount: unknown): this {
    return this.with('amount', amount);
  }

  withCurrency(currency: unknown): this {
    return this.with('currency', currency);
  }

  with(field: string, value: unknown): this {
    this.fields[field] = value;
    return this;
  }

  without(field: string): this {
    delete this.fields[field];
    return this;
  }

  build(): Record<string, unknown> {
    return { ...this.fields };
  }
}

export const aWebhookEvent = (): WebhookEventBuilder => new WebhookEventBuilder();
