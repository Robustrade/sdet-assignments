
import { randomUUID } from 'node:crypto';

import type {
  PaymentWebhook,
  PaymentWebhookType
} from '../../src/webhooks/WebhookTypes.js';

export class WebhookBuilder {
  private eventId = `evt_${randomUUID()}`;
  private createdAt = new Date().toISOString();
  private invoiceId = 'inv_test_001';
  private subscriptionId = 'sub_test_001';

  private eventType: PaymentWebhookType = 'payment.succeeded';
  private providerReference = 'provider_ref_001';
  private failureReason = 'Payment declined';

  withEventId(eventId: string): this {
    this.eventId = eventId;
    return this;
  }

  withCreatedAt(createdAt: string): this {
    this.createdAt = createdAt;
    return this;
  }

  withInvoiceId(invoiceId: string): this {
    this.invoiceId = invoiceId;
    return this;
  }

  withSubscriptionId(subscriptionId: string): this {
    this.subscriptionId = subscriptionId;
    return this;
  }

  asSucceeded(providerReference?: string): this {
    this.eventType = 'payment.succeeded';

    if (providerReference) {
      this.providerReference = providerReference;
    }

    return this;
  }

  asFailed(failureReason?: string): this {
    this.eventType = 'payment.failed';

    if (failureReason) {
      this.failureReason = failureReason;
    }

    return this;
  }

  build(): PaymentWebhook {
    const base = {
      event_id: this.eventId,
      created_at: this.createdAt,
      data: {
        invoice_id: this.invoiceId,
        subscription_id: this.subscriptionId
      }
    };

    if (this.eventType === 'payment.succeeded') {
      return {
        ...base,
        event_type: 'payment.succeeded',
        data: {
          ...base.data,
          provider_reference: this.providerReference
        }
      };
    }

    return {
      ...base,
      event_type: 'payment.failed',
      data: {
        ...base.data,
        failure_reason: this.failureReason
      }
    };
  }
}
