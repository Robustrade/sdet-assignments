/**
 * Builder Pattern - Invoice Builder
 */

import { Invoice, InvoiceStatus } from '../../src/domain/subscription/types';
import { randomUUID } from 'crypto';

export class InvoiceBuilder {
  private invoice: Partial<Invoice> = {
    status: 'pending',
    currency: 'USD',
    amount: 4900,
    attempt_count: 1,
    created_at: new Date(),
  };

  withId(id: string): this {
    this.invoice.id = id;
    return this;
  }

  withSubscriptionId(subscriptionId: string): this {
    this.invoice.subscription_id = subscriptionId;
    return this;
  }

  withAmount(amount: number): this {
    this.invoice.amount = amount;
    return this;
  }

  withCurrency(currency: string): this {
    this.invoice.currency = currency;
    return this;
  }

  withStatus(status: InvoiceStatus): this {
    this.invoice.status = status;
    return this;
  }

  withAttemptCount(count: number): this {
    this.invoice.attempt_count = count;
    return this;
  }

  withPaidAt(paidAt: Date): this {
    this.invoice.paid_at = paidAt;
    return this;
  }

  pending(): this {
    this.invoice.status = 'pending';
    return this;
  }

  paid(): this {
    this.invoice.status = 'paid';
    this.invoice.paid_at = new Date();
    return this;
  }

  failed(): this {
    this.invoice.status = 'failed';
    return this;
  }

  build(): Invoice {
    return {
      id: this.invoice.id || `inv_${randomUUID()}`,
      subscription_id: this.invoice.subscription_id || 'sub_default',
      amount: this.invoice.amount || 4900,
      currency: this.invoice.currency || 'USD',
      status: this.invoice.status || 'pending',
      attempt_count: this.invoice.attempt_count || 1,
      created_at: this.invoice.created_at || new Date(),
      paid_at: this.invoice.paid_at,
    };
  }
}
