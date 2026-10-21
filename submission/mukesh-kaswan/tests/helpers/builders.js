const { sign } = require('../../src/signature');
const { WEBHOOK_SECRET } = require('./testConfig');

let counter = 0;
const uniqueId = (prefix) => `${prefix}_test_${++counter}`;

/** Builder for POST /subscriptions request bodies. Defaults to a valid request. */
class SubscriptionRequestBuilder {
  constructor() {
    this.body = { customer_id: 'cust_001', plan: 'basic', payment_method_id: 'pm_test_visa_4242' };
  }

  onPlan(plan) {
    this.body.plan = plan;
    return this;
  }

  forCustomer(customerId) {
    this.body.customer_id = customerId;
    return this;
  }

  withPaymentMethod(paymentMethodId) {
    this.body.payment_method_id = paymentMethodId;
    return this;
  }

  without(field) {
    delete this.body[field];
    return this;
  }

  build() {
    return { ...this.body };
  }
}

/**
 * Builder for signed payment-provider webhooks.
 * build() returns { body, signature, payload }: body is the exact raw string
 * that is signed and sent, so the signature always matches unless we say otherwise.
 */
class WebhookBuilder {
  constructor() {
    this.payload = {
      event_id: uniqueId('evt'),
      type: 'payment.succeeded',
      subscription_id: 'sub_unknown',
      invoice_id: uniqueId('inv'),
      amount: 1900,
      currency: 'USD',
    };
    this.signatureMode = 'valid';
    this.rawBody = null;
  }

  paymentSucceeded(subscription) {
    return this.ofType('payment.succeeded').forSubscription(subscription);
  }

  paymentFailed(subscription, { finalAttempt = false } = {}) {
    this.ofType('payment.failed').forSubscription(subscription).with('failure_reason', 'card_declined');
    return finalAttempt ? this.with('final_attempt', true) : this;
  }

  paymentRefunded(subscription) {
    return this.ofType('payment.refunded').forSubscription(subscription);
  }

  forSubscription(subscription) {
    this.payload.subscription_id = subscription.id;
    this.payload.amount = subscription.price;
    this.payload.currency = subscription.currency;
    return this;
  }

  ofType(type) {
    return this.with('type', type);
  }

  withEventId(eventId) {
    return this.with('event_id', eventId);
  }

  withInvoiceId(invoiceId) {
    return this.with('invoice_id', invoiceId);
  }

  with(field, value) {
    this.payload[field] = value;
    return this;
  }

  without(field) {
    delete this.payload[field];
    return this;
  }

  withForgedSignature() {
    this.signatureMode = 'forged';
    return this;
  }

  unsigned() {
    this.signatureMode = 'none';
    return this;
  }

  withMalformedBody() {
    this.rawBody = '{"event_id": "evt_broken", "type": ';
    return this;
  }

  build() {
    const body = this.rawBody ?? JSON.stringify(this.payload);
    const signatures = {
      valid: sign(body, WEBHOOK_SECRET),
      forged: sign(body, 'attacker-guessed-secret'),
      none: undefined,
    };
    return { body, signature: signatures[this.signatureMode], payload: { ...this.payload } };
  }
}

const aSubscription = () => new SubscriptionRequestBuilder();
const aWebhook = () => new WebhookBuilder();

module.exports = { aSubscription, aWebhook };
