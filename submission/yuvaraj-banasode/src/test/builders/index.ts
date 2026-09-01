/**
 * Test Data Builders (Builder Pattern)
 * 
 * Fluent builders for constructing test data: customers, subscriptions, webhooks, etc.
 * Eliminates repetitive setup and makes test intent clear.
 */

import { v4 as uuid } from 'uuid';
import {
  Customer,
  Subscription,
  Invoice,
  WebhookPayload,
  SubscriptionState,
} from '../../types';
import crypto from 'crypto';

/**
 * CustomerBuilder: Fluent construction of test customers
 */
export class CustomerBuilder {
  private customer: Customer = {
    id: `cust_${uuid()}`,
    name: 'Test Customer',
    email: 'test@example.com',
    createdAt: new Date(),
  };

  withId(id: string): this {
    this.customer.id = id;
    return this;
  }

  withName(name: string): this {
    this.customer.name = name;
    return this;
  }

  withEmail(email: string): this {
    this.customer.email = email;
    return this;
  }

  build(): Customer {
    return { ...this.customer };
  }
}

/**
 * SubscriptionBuilder: Fluent construction of test subscriptions
 */
export class SubscriptionBuilder {
  private subscription: Subscription = {
    id: `sub_${uuid()}`,
    customerId: `cust_${uuid()}`,
    planId: 'pro',
    state: 'trialing',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    trialEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  withId(id: string): this {
    this.subscription.id = id;
    return this;
  }

  withCustomerId(customerId: string): this {
    this.subscription.customerId = customerId;
    return this;
  }

  withPlan(planId: string): this {
    this.subscription.planId = planId;
    return this;
  }

  withState(state: SubscriptionState): this {
    this.subscription.state = state;
    return this;
  }

  withTrialEnd(date: Date): this {
    this.subscription.trialEnd = date;
    return this;
  }

  withCanceledAt(date: Date): this {
    this.subscription.canceledAt = date;
    return this;
  }

  build(): Subscription {
    return { ...this.subscription };
  }
}

/**
 * InvoiceBuilder: Fluent construction of test invoices
 */
export class InvoiceBuilder {
  private invoice: Invoice = {
    id: `inv_${uuid()}`,
    subscriptionId: `sub_${uuid()}`,
    amount: 2999,
    currency: 'USD',
    status: 'succeeded',
    eventType: 'payment.succeeded',
    createdAt: new Date(),
  };

  withId(id: string): this {
    this.invoice.id = id;
    return this;
  }

  withSubscriptionId(subscriptionId: string): this {
    this.invoice.subscriptionId = subscriptionId;
    return this;
  }

  withAmount(amount: number): this {
    this.invoice.amount = amount;
    return this;
  }

  withStatus(status: 'succeeded' | 'failed'): this {
    this.invoice.status = status;
    this.invoice.eventType =
      status === 'succeeded' ? 'payment.succeeded' : 'payment.failed';
    return this;
  }

  build(): Invoice {
    return { ...this.invoice };
  }
}

/**
 * WebhookPayloadBuilder: Fluent construction of webhook payloads
 * 
 * Supports signing payloads with HMAC-SHA256 for signature validation testing.
 */
export class WebhookPayloadBuilder {
  private payload: WebhookPayload = {
    event_id: `evt_${uuid()}`,
    type: 'payment.succeeded',
    subscription_id: `sub_${uuid()}`,
    amount: 2999,
    currency: 'USD',
  };

  private webhookSecret = 'test_secret';

  withEventId(eventId: string): this {
    this.payload.event_id = eventId;
    return this;
  }

  withType(type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded'): this {
    this.payload.type = type;
    return this;
  }

  withSubscriptionId(subscriptionId: string): this {
    this.payload.subscription_id = subscriptionId;
    return this;
  }

  withAmount(amount: number): this {
    this.payload.amount = amount;
    return this;
  }

  withInvoiceId(invoiceId: string): this {
    this.payload.invoice_id = invoiceId;
    return this;
  }

  build(): WebhookPayload {
    return { ...this.payload };
  }

  /**
   * Build and sign payload
   * Returns: { payload, signature }
   */
  buildSigned(): { payload: WebhookPayload; signature: string } {
    const payload = this.build();
    const rawBody = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return { payload, signature };
  }

  /**
   * Build with invalid signature (for negative testing)
   */
  buildWithInvalidSignature(): { payload: WebhookPayload; signature: string } {
    const payload = this.build();
    return { payload, signature: 'invalid_signature_12345' };
  }

  /**
   * Build with malformed JSON (for error handling testing)
   */
  buildMalformedJson(): string {
    return '{ "event_id": "evt_001", invalid json }';
  }
}
