import type { InvoiceRecord, InvoiceStatus } from '../../../src/domain/Invoice';

/**
 * Builder for stored invoice rows (arrange only, like SubscriptionRecordBuilder). Defaults to the
 * pending first invoice of the seeded `pro` subscription. The idempotency key follows the attempt
 * number unless set explicitly, so several invoices for one subscription never collide.
 */
export class InvoiceRecordBuilder {
  private record: InvoiceRecord = {
    id: 'inv_seed_001',
    subscriptionId: 'sub_seed_001',
    amount: 4900,
    currency: 'USD',
    status: 'pending',
    attempt: 1,
    idempotencyKey: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  private explicitKey?: string;

  withId(id: string): this {
    return this.merge({ id });
  }

  forSubscription(subscriptionId: string): this {
    return this.merge({ subscriptionId });
  }

  withStatus(status: InvoiceStatus): this {
    return this.merge({ status });
  }

  pending(): this {
    return this.withStatus('pending');
  }

  paid(): this {
    return this.withStatus('paid');
  }

  failed(): this {
    return this.withStatus('failed');
  }

  refunded(): this {
    return this.withStatus('refunded');
  }

  attempt(attempt: number): this {
    return this.merge({ attempt });
  }

  withAmount(amount: number, currency = 'USD'): this {
    return this.merge({ amount, currency });
  }

  /** Sets both timestamps (ISO-8601): the invoice was created and last changed at this instant. */
  at(iso: string): this {
    return this.merge({ createdAt: iso, updatedAt: iso });
  }

  createdAt(iso: string): this {
    return this.merge({ createdAt: iso });
  }

  updatedAt(iso: string): this {
    return this.merge({ updatedAt: iso });
  }

  withIdempotencyKey(key: string): this {
    this.explicitKey = key;
    return this;
  }

  build(): InvoiceRecord {
    const idempotencyKey = this.explicitKey ?? `seed:${this.record.subscriptionId}:${this.record.attempt}`;
    return { ...this.record, idempotencyKey };
  }

  private merge(changes: Partial<InvoiceRecord>): this {
    this.record = { ...this.record, ...changes };
    return this;
  }
}

export const anInvoiceRecord = (): InvoiceRecordBuilder => new InvoiceRecordBuilder();
