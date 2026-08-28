const { v4: uuidv4 } = require('uuid');

const PLANS = {
  basic: { price: 1900, currency: 'USD', trial_days: 14 },
  pro: { price: 4900, currency: 'USD', trial_days: 7 }
};

const VALID_TRANSITIONS = {
  trialing: { payment_succeeded: 'active', payment_failed: 'past_due', cancel: 'canceled' },
  active: { payment_failed: 'past_due', payment_refunded: 'past_due', cancel: 'canceled' },
  past_due: { payment_succeeded: 'active', payment_failed: 'canceled' },
  canceled: {}
};

class SubscriptionService {
  constructor(repository, paymentProvider) {
    this.repository = repository;
    this.paymentProvider = paymentProvider;
  }

  createSubscription(data) {
    const plan = PLANS[data.plan];
    if (!plan) throw this.error('plan must be basic or pro', 400);
    if (!data.customer_id || !this.repository.getCustomer(data.customer_id)) {
      throw this.error('customer_id must reference a known customer', 400);
    }
    if (!data.payment_method_id) throw this.error('payment_method_id is required', 400);

    const subscription = {
      id: `sub_${uuidv4()}`,
      customer_id: data.customer_id,
      plan: data.plan,
      payment_method_id: data.payment_method_id,
      status: 'trialing',
      trial_days: plan.trial_days,
      price: plan.price,
      currency: plan.currency
    };
    this.repository.addSubscription(subscription);
    this.audit(subscription, null, 'created');
    return subscription;
  }

  getSubscription(id) {
    return this.repository.getSubscription(id);
  }

  cancelSubscription(id) {
    const subscription = this.requireSubscription(id);
    this.transition(subscription, 'cancel');
    return subscription;
  }

  changePlan(id, planName) {
    const subscription = this.requireSubscription(id);
    const plan = PLANS[planName];
    if (!plan) throw this.error('plan must be basic or pro', 400);
    if (subscription.status !== 'active') throw this.error('Only active subscriptions can change plans', 409);

    subscription.plan = planName;
    subscription.price = plan.price;
    subscription.currency = plan.currency;
    subscription.trial_days = plan.trial_days;
    this.repository.updateSubscription(subscription);
    this.audit(subscription, null, `plan_changed_to_${planName}`);
    return subscription;
  }

  processWebhook(payload) {
    if (this.repository.hasWebhook(payload.event_id)) return { duplicate: true, subscription: this.getSubscription(payload.subscription_id) };

    const subscription = this.requireSubscription(payload.subscription_id);
    const invoice = this.repository.getInvoice(payload.invoice_id);
    this.repository.recordWebhook({ ...payload, processed: false });

    if (invoice && invoice.status === 'succeeded') {
      return { duplicate: true, subscription };
    }

    const transition = payload.type.replace('.', '_');
    this.transition(subscription, transition);
    this.repository.addInvoice({
      id: payload.invoice_id,
      subscription_id: subscription.id,
      amount: payload.amount,
      currency: payload.currency,
      status: transition === 'payment_succeeded' ? 'succeeded' : 'failed',
      event_id: payload.event_id
    });
    this.repository.webhookEvents.get(payload.event_id).processed = true;
    this.audit(subscription, payload.event_id, payload.type);
    return { duplicate: false, subscription };
  }

  charge(subscriptionId) {
    const subscription = this.requireSubscription(subscriptionId);
    const invoiceId = `inv_${uuidv4()}`;
    const result = this.paymentProvider.charge({
      customer_id: subscription.customer_id,
      payment_method_id: subscription.payment_method_id,
      amount: subscription.price,
      currency: subscription.currency,
      idempotency_key: invoiceId
    });
    const type = result.status === 'succeeded' ? 'payment.succeeded' : 'payment.failed';
    return this.processWebhook({
      event_id: `evt_${uuidv4()}`,
      type,
      subscription_id: subscription.id,
      invoice_id: invoiceId,
      amount: subscription.price,
      currency: subscription.currency
    });
  }

  transition(subscription, trigger) {
    const next = VALID_TRANSITIONS[subscription.status]?.[trigger];
    if (!next) throw this.error(`Invalid transition from ${subscription.status} using ${trigger}`, 409);
    const previous = subscription.status;
    subscription.status = next;
    this.repository.updateSubscription(subscription);
    this.audit(subscription, null, `${previous}->${next}`);
  }

  requireSubscription(id) {
    const subscription = this.getSubscription(id);
    if (!subscription) throw this.error('Subscription not found', 404);
    return subscription;
  }

  audit(subscription, eventId, action) {
    this.repository.addAuditEvent({ subscription_id: subscription.id, event_id: eventId, action, status: subscription.status });
  }

  error(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
  }
}

module.exports = { PLANS, VALID_TRANSITIONS, SubscriptionService };