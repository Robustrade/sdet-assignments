import { SubscriptionStatus } from './subscriptionStateMachine.js';

const now = () => new Date().toISOString();
const DOMAIN_EVENTS = new Set(['payment.succeeded', 'payment.failed', 'payment.refunded']);

export class SubscriptionService {
  constructor({ repository, paymentProvider, planCatalog, stateMachine }) {
    Object.assign(this, { repository, paymentProvider, planCatalog, stateMachine });
  }

  getSubscription(id) { return this.repository.getSubscription(id); }

  async createSubscription(input) {
    const customerId = String(input?.customer_id ?? '').trim();
    const methodId = String(input?.payment_method_id ?? '').trim();
    const planName = String(input?.plan ?? '').trim().toLowerCase();
    if (!customerId || !methodId || !planName) throw new Error('customer_id, payment_method_id, and plan are required');
    if (!this.repository.hasCustomer(customerId)) throw new Error(`Customer ${customerId} not found`);
    const plan = this.planCatalog.get(planName);
    if (!plan) throw new Error(`Unknown plan: ${planName}`);

    const timestamp = now();
    const subscription = {
      id: this.repository.nextSubscriptionId(), customer_id: customerId,
      plan: plan.name, payment_method_id: methodId, status: SubscriptionStatus.TRIALING,
      amount: plan.price, currency: plan.currency ?? 'USD', trial_days: plan.trialDays,
      created_at: timestamp, updated_at: timestamp,
    };
    this.repository.addSubscription(subscription);
    this.repository.recordAudit(subscription.id, 'subscription_created', { customer_id: customerId, plan: plan.name, amount: plan.price });
    return this.getSubscription(subscription.id);
  }

  async cancelSubscription(id) {
    const subscription = this.repository.getSubscription(id);
    if (!subscription) throw new Error(`Subscription ${id} not found`);
    const nextStatus = this.stateMachine.transition(subscription.status, 'api_cancel');
    const updated = { ...subscription, status: nextStatus, canceled_at: now(), updated_at: now() };
    this.repository.updateSubscription(updated);
    this.repository.recordAudit(id, 'subscription_cancelled', { previous_status: subscription.status, next_status: nextStatus });
    return this.getSubscription(id);
  }

  async exhaustRetries(subscriptionId) {
    const subscription = this.repository.getSubscription(subscriptionId);
    if (!subscription) throw new Error(`Subscription ${subscriptionId} not found`);
    const nextStatus = this.stateMachine.transition(subscription.status, 'retries_exhausted');
    const updated = { ...subscription, status: nextStatus, updated_at: now() };
    this.repository.updateSubscription(updated);
    this.repository.recordAudit(subscriptionId, 'retries_exhausted', { previous_status: subscription.status, next_status: nextStatus });
    return this.getSubscription(subscriptionId);
  }

  /** Simulates a genuine charge attempt. Provider outcome, never caller intent, drives state. */
  async completeTrial(subscriptionId) {
    const subscription = this.repository.getSubscription(subscriptionId);
    if (!subscription) throw new Error(`Subscription ${subscriptionId} not found`);
    if (subscription.status !== SubscriptionStatus.TRIALING) throw new Error('trial can only be completed for a trialing subscription');

    const invoiceId = this.repository.nextInvoiceId();
    const request = {
      customerId: subscription.customer_id, amount: subscription.amount,
      paymentMethodId: subscription.payment_method_id, subscriptionId: subscription.id,
      invoiceId, currency: subscription.currency, idempotencyKey: `charge:${invoiceId}`,
    };
    let providerResult;
    try {
      providerResult = await this.paymentProvider.charge(request);
    } catch (error) {
      providerResult = { success: false, status: 'unknown', error: error.message };
    }

    const succeeded = providerResult.success === true;
    const event = {
      event_id: `evt_${invoiceId}`, type: succeeded ? 'payment.succeeded' : 'payment.failed',
      subscription_id: subscription.id, invoice_id: invoiceId, amount: subscription.amount,
      currency: subscription.currency, provider_status: providerResult.status ?? (succeeded ? 'succeeded' : 'failed'),
    };
    return this.#applyPaymentEvent(event, { source: 'provider', providerResult });
  }

  async processWebhook(payload) {
    this.#validateWebhook(payload);
    const subscription = this.repository.getSubscription(payload.subscription_id);
    if (!subscription) throw new Error(`Subscription ${payload.subscription_id} not found`);
    if (Number(payload.amount) !== subscription.amount || String(payload.currency).toUpperCase() !== subscription.currency) {
      throw new Error('Webhook amount/currency does not match subscription billing terms');
    }

    const priorEvent = this.repository.getEvent(payload.event_id);
    if (priorEvent) {
      this.repository.incrementDuplicateDelivery(payload.event_id);
      this.repository.recordAudit(subscription.id, 'duplicate_webhook_ignored', { event_id: payload.event_id });
      return { duplicate: true, subscription: this.getSubscription(subscription.id), event: this.repository.getEvent(payload.event_id) };
    }

    // Canceled is terminal: retain an auditable no-op, but never mutate subscription/invoice.
    if (subscription.status === SubscriptionStatus.CANCELED) {
      this.#recordIgnoredEvent(payload, 'ignored_canceled_subscription');
      return { ignored: true, reason: 'subscription is canceled', subscription: this.getSubscription(subscription.id) };
    }

    const existingInvoice = this.repository.getInvoice(payload.invoice_id);
    if (existingInvoice) {
      // A success is authoritative for an invoice. A late failure cannot downgrade it.
      if (existingInvoice.status === 'paid' && payload.type === 'payment.failed') {
        this.#recordIgnoredEvent(payload, 'ignored_stale_failure');
        return { ignored: true, reason: 'invoice already paid', subscription: this.getSubscription(subscription.id) };
      }
      if (existingInvoice.status === 'refunded' || existingInvoice.status === 'failed') {
        this.#recordIgnoredEvent(payload, 'ignored_conflicting_invoice_event');
        return { ignored: true, reason: `invoice already ${existingInvoice.status}`, subscription: this.getSubscription(subscription.id) };
      }
    }

    if (payload.type === 'payment.refunded') {
      if (!existingInvoice || existingInvoice.status !== 'paid') {
        this.#recordIgnoredEvent(payload, 'ignored_refund_without_paid_invoice');
        return { ignored: true, reason: 'refund requires a paid invoice', subscription: this.getSubscription(subscription.id) };
      }
      const refunded = { ...existingInvoice, status: 'refunded', refunded_at: now(), refund_event_id: payload.event_id };
      this.repository.updateInvoice(refunded);
      this.#recordEvent(payload, 'processed', 'payment.refunded');
      this.repository.recordAudit(subscription.id, 'payment.refunded', { invoice_id: payload.invoice_id, amount: payload.amount });
      return { ignored: false, subscription: this.getSubscription(subscription.id), invoice: refunded };
    }

    return this.#applyPaymentEvent(payload, { source: 'webhook' });
  }

  #validateWebhook(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Webhook payload must be a JSON object');
    if (!payload.event_id || !payload.subscription_id || !payload.invoice_id || !DOMAIN_EVENTS.has(payload.type)) throw new Error('Webhook payload is invalid');
    if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) <= 0) throw new Error('Webhook amount must be a positive number');
    if (typeof payload.currency !== 'string' || payload.currency.length !== 3) throw new Error('Webhook currency must be a three-letter code');
  }

  #recordEvent(payload, status, reason) {
    this.repository.recordWebhookEvent({
      event_id: payload.event_id, subscription_id: payload.subscription_id,
      invoice_id: payload.invoice_id, type: payload.type, status, reason,
      delivery_count: 1, duplicate_count: 0, processed_at: now(),
    });
  }

  #recordIgnoredEvent(payload, reason) {
    this.#recordEvent(payload, 'ignored', reason);
    this.repository.recordAudit(payload.subscription_id, 'webhook_ignored', { event_id: payload.event_id, invoice_id: payload.invoice_id, reason });
  }

  #applyPaymentEvent(payload, { source, providerResult } = {}) {
    const subscription = this.repository.getSubscription(payload.subscription_id);
    const trigger = payload.type.replace(/\./g, '_');
    const nextStatus = this.stateMachine.transition(subscription.status, trigger);
    const succeeded = payload.type === 'payment.succeeded' && (source !== 'provider' || providerResult?.success === true);
    const invoice = {
      id: payload.invoice_id, subscription_id: subscription.id, event_id: payload.event_id,
      amount: Number(payload.amount), currency: payload.currency,
      status: succeeded ? 'paid' : (providerResult?.status === 'unknown' ? 'unknown' : 'failed'),
      provider_status: providerResult?.status ?? (succeeded ? 'succeeded' : 'failed'),
      provider_reference: providerResult?.provider_reference ?? null,
      created_at: now(),
    };
    this.repository.addInvoice(invoice);
    this.#recordEvent(payload, 'processed', null);
    const updated = { ...subscription, status: nextStatus, updated_at: now() };
    this.repository.updateSubscription(updated);
    this.repository.recordAudit(subscription.id, payload.type, { invoice_id: invoice.id, previous_status: subscription.status, next_status: nextStatus, invoice_status: invoice.status });
    return { duplicate: false, subscription: this.getSubscription(subscription.id), invoice };
  }
}
