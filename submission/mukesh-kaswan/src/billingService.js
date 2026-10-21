const { ApiError } = require('./errors');
const { findPlan } = require('./plans');
const { nextState } = require('./stateMachine');
const { PaymentProviderTimeoutError } = require('./paymentProvider');

const REQUIRED_CREATE_FIELDS = ['customer_id', 'plan', 'payment_method_id'];
const REQUIRED_WEBHOOK_FIELDS = ['event_id', 'subscription_id', 'invoice_id'];
const WEBHOOK_TYPES = ['payment.succeeded', 'payment.failed', 'payment.refunded'];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Business logic for subscriptions and billing.
 * Dependencies (repository + payment provider) are injected, so tests decide
 * which payment provider is used.
 */
class BillingService {
  constructor({ repository, paymentProvider }) {
    this.repo = repository;
    this.paymentProvider = paymentProvider;
  }

  async createSubscription(body) {
    validateCreateRequest(body);
    const plan = findPlan(body.plan);
    if (!plan) throw new ApiError(400, 'UNKNOWN_PLAN', `Unknown plan '${body.plan}'`);
    if (!this.repo.findCustomer(body.customer_id)) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', `Customer '${body.customer_id}' not found`);
    }

    const now = new Date();
    const subscription = {
      id: this.repo.nextId('sub'),
      customer_id: body.customer_id,
      plan: plan.id,
      payment_method_id: body.payment_method_id,
      status: 'trialing',
      price: plan.price,
      currency: plan.currency,
      trial_ends_at: new Date(now.getTime() + plan.trial_days * DAY_MS).toISOString(),
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      canceled_at: null,
    };
    this.repo.saveSubscription(subscription);
    this.repo.addAuditEntry({
      subscription_id: subscription.id, from: null, to: 'trialing', event: 'create', trigger: 'api', at: subscription.created_at,
    });

    // A plan with no trial is charged straight away: the trial "ends" at creation.
    if (plan.trial_days === 0) await this.chargeNow(subscription);

    return this.repo.findSubscription(subscription.id);
  }

  getSubscription(id) {
    const subscription = this.repo.findSubscription(id);
    if (!subscription) throw new ApiError(404, 'SUBSCRIPTION_NOT_FOUND', `Subscription '${id}' not found`);
    return subscription;
  }

  cancelSubscription(id) {
    this.getSubscription(id);
    return this.transition(id, 'cancel', 'api');
  }

  /** Business handling of an already signature-checked, parsed webhook. */
  handleWebhook(event) {
    validateWebhook(event);

    const alreadySeen = this.repo.findWebhookEvent(event.event_id);
    if (alreadySeen) {
      this.repo.saveWebhookEvent({ ...alreadySeen, delivery_count: alreadySeen.delivery_count + 1 });
      return { result: 'duplicate' };
    }

    const subscription = this.getSubscription(event.subscription_id);
    const outcome = this.applyWebhook(subscription, event);

    this.repo.saveWebhookEvent({
      event_id: event.event_id,
      type: event.type,
      subscription_id: event.subscription_id,
      invoice_id: event.invoice_id,
      outcome,
      delivery_count: 1,
      received_at: new Date().toISOString(),
    });
    return { result: outcome };
  }

  applyWebhook(subscription, event) {
    const invoice = this.repo.findInvoice(event.invoice_id);
    const now = new Date().toISOString();

    // An invoice belongs to one subscription; a webhook must not move or overwrite it.
    if (invoice && invoice.subscription_id !== subscription.id) return 'ignored_invoice_mismatch';

    if (event.type === 'payment.refunded') {
      if (invoice?.status !== 'paid') return 'ignored_no_paid_invoice';
      this.repo.saveInvoice({ ...invoice, status: 'refunded', updated_at: now });
      return 'processed';
    }

    // A charge must be for the plan price, otherwise an underpayment could activate the subscription.
    if (event.amount !== subscription.price || event.currency !== subscription.currency) {
      return 'ignored_amount_mismatch';
    }

    // Out-of-order delivery: once an invoice is settled, later events for it are stale.
    if (invoice?.status === 'paid' || invoice?.status === 'refunded') return 'ignored_stale';

    const lifecycleEvent = toLifecycleEvent(subscription, event);
    if (!nextState(subscription.status, lifecycleEvent)) return 'ignored_invalid_transition';

    const succeeded = event.type === 'payment.succeeded';
    this.repo.saveInvoice({
      id: event.invoice_id,
      subscription_id: subscription.id,
      amount: event.amount,
      currency: event.currency,
      status: succeeded ? 'paid' : 'failed',
      failure_reason: succeeded ? null : (event.failure_reason ?? 'unknown'),
      created_at: invoice?.created_at ?? now,
      updated_at: now,
    });
    this.transition(subscription.id, lifecycleEvent, `webhook:${event.type}`);
    return 'processed';
  }

  async chargeNow(subscription) {
    const invoiceId = this.repo.nextId('inv');
    let status = 'paid';
    let failureReason = null;
    try {
      const result = await this.paymentProvider.charge({
        customer_id: subscription.customer_id,
        payment_method_id: subscription.payment_method_id,
        amount: subscription.price,
        currency: subscription.currency,
        idempotency_key: invoiceId,
      });
      if (result.status !== 'succeeded') {
        status = 'failed';
        failureReason = result.decline_code ?? 'declined';
      }
    } catch (err) {
      if (!(err instanceof PaymentProviderTimeoutError)) throw err;
      status = 'failed';
      failureReason = 'provider_timeout';
    }

    const now = new Date().toISOString();
    this.repo.saveInvoice({
      id: invoiceId,
      subscription_id: subscription.id,
      amount: subscription.price,
      currency: subscription.currency,
      status,
      failure_reason: failureReason,
      created_at: now,
      updated_at: now,
    });
    this.transition(subscription.id, status === 'paid' ? 'charge_succeeded' : 'charge_failed', 'provider.charge');
  }

  /** The ONLY place a subscription's status is changed. */
  transition(subscriptionId, event, trigger) {
    const subscription = this.repo.findSubscription(subscriptionId);
    const to = nextState(subscription.status, event);
    if (!to) {
      throw new ApiError(409, 'INVALID_TRANSITION', `Cannot apply '${event}' to a ${subscription.status} subscription`);
    }
    if (to === subscription.status) return subscription; // renewal / retry: no state change

    const now = new Date().toISOString();
    const updated = {
      ...subscription,
      status: to,
      updated_at: now,
      canceled_at: to === 'canceled' ? now : subscription.canceled_at,
    };
    this.repo.saveSubscription(updated);
    this.repo.addAuditEntry({ subscription_id: subscriptionId, from: subscription.status, to, event, trigger, at: now });
    return updated;
  }
}

function toLifecycleEvent(subscription, event) {
  if (event.type === 'payment.succeeded') return 'charge_succeeded';
  if (subscription.status === 'past_due' && event.final_attempt === true) return 'retries_exhausted';
  return 'charge_failed';
}

function validateCreateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object');
  }
  for (const field of REQUIRED_CREATE_FIELDS) {
    if (typeof body[field] !== 'string' || body[field].trim() === '') {
      throw new ApiError(400, 'VALIDATION_ERROR', `'${field}' is required`);
    }
  }
  if (!body.payment_method_id.startsWith('pm_')) {
    throw new ApiError(400, 'INVALID_PAYMENT_METHOD', `'${body.payment_method_id}' is not a valid payment method`);
  }
}

function validateWebhook(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new ApiError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Webhook body must be a JSON object');
  }
  for (const field of REQUIRED_WEBHOOK_FIELDS) {
    if (typeof event[field] !== 'string' || event[field] === '') {
      throw new ApiError(400, 'INVALID_WEBHOOK_PAYLOAD', `'${field}' is required`);
    }
  }
  if (!WEBHOOK_TYPES.includes(event.type)) {
    throw new ApiError(400, 'UNKNOWN_EVENT_TYPE', `Unsupported event type '${event.type}'`);
  }
  if (!Number.isInteger(event.amount) || event.amount <= 0) {
    throw new ApiError(400, 'INVALID_WEBHOOK_PAYLOAD', "'amount' must be a positive integer");
  }
}

module.exports = { BillingService };
