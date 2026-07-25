const { PlanFactory } = require('../domain/plans');
const {
  SubscriptionState,
  TransitionTrigger,
  SubscriptionStateMachine,
} = require('../domain/subscriptionStateMachine');

class SubscriptionService {
  constructor({
    subscriptionRepo,
    invoiceRepo,
    webhookRepo,
    auditRepo,
    paymentProvider,
    customerStore,
  }) {
    this.subscriptionRepo = subscriptionRepo;
    this.invoiceRepo = invoiceRepo;
    this.webhookRepo = webhookRepo;
    this.auditRepo = auditRepo;
    this.paymentProvider = paymentProvider;
    this.customerStore = customerStore;
    this.idSeq = 0;
  }

  async createSubscription({ customerId, plan, paymentMethodId }) {
    if (!customerId || !paymentMethodId) {
      const err = new Error('VALIDATION_ERROR');
      err.statusCode = 400;
      throw err;
    }

    if (!this.customerStore.has(customerId)) {
      const err = new Error('UNKNOWN_CUSTOMER');
      err.statusCode = 404;
      throw err;
    }

    let selectedPlan;
    try {
      selectedPlan = PlanFactory.create(plan);
    } catch {
      const err = new Error('UNKNOWN_PLAN');
      err.statusCode = 400;
      throw err;
    }

    const id = `sub_${String(++this.idSeq).padStart(3, '0')}`;
    const now = new Date().toISOString();
    const subscription = {
      id,
      customerId,
      plan: selectedPlan.code,
      priceCents: selectedPlan.priceCents,
      trialDays: selectedPlan.trialDays,
      status: selectedPlan.startsInTrial()
        ? SubscriptionState.TRIALING
        : SubscriptionState.ACTIVE,
      canceledAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.subscriptionRepo.save(subscription);
    this.auditRepo.add({
      subscriptionId: id,
      action: 'subscription.created',
      details: { plan: selectedPlan.code, state: subscription.status },
      createdAt: now,
    });

    if (!selectedPlan.startsInTrial()) {
      const reference = `create:${id}`;
      const invoiceId = `inv_create_${id}`;
      await this._attemptCharge({
        subscriptionId: id,
        invoiceId,
        customerId,
        paymentMethodId,
        amount: selectedPlan.priceCents,
        currency: 'USD',
        reference,
        source: 'api.create',
      });
    }

    return this.subscriptionRepo.getById(id);
  }

  getSubscription(id) {
    return this.subscriptionRepo.getById(id);
  }

  cancelSubscription(id) {
    const sub = this.subscriptionRepo.getById(id);
    if (!sub) {
      const err = new Error('NOT_FOUND');
      err.statusCode = 404;
      throw err;
    }

    if (sub.status === SubscriptionState.CANCELED) {
      const err = new Error('ALREADY_CANCELED');
      err.statusCode = 409;
      throw err;
    }

    const now = new Date().toISOString();
    sub.status = SubscriptionStateMachine.transition(
      sub.status,
      TransitionTrigger.API_CANCEL,
    );
    sub.canceledAt = now;
    sub.updatedAt = now;

    this.subscriptionRepo.save(sub);
    this.auditRepo.add({
      subscriptionId: id,
      action: 'subscription.canceled',
      details: { source: 'api.cancel' },
      createdAt: now,
    });

    return sub;
  }

  async processWebhook(event) {
    const now = new Date().toISOString();
    if (this.webhookRepo.hasProcessed(event.event_id)) {
      this.webhookRepo.add({
        eventId: event.event_id,
        type: event.type,
        subscriptionId: event.subscription_id,
        duplicate: true,
        processedAt: now,
      });
      return { duplicate: true, applied: false };
    }

    this.webhookRepo.markProcessed(event.event_id);
    this.webhookRepo.add({
      eventId: event.event_id,
      type: event.type,
      subscriptionId: event.subscription_id,
      duplicate: false,
      processedAt: now,
    });

    const sub = this.subscriptionRepo.getById(event.subscription_id);
    if (!sub) {
      return {
        duplicate: false,
        applied: false,
        ignoredReason: 'unknown_subscription',
      };
    }

    if (sub.status === SubscriptionState.CANCELED) {
      this.auditRepo.add({
        subscriptionId: sub.id,
        action: 'webhook.ignored',
        details: {
          reason: 'already_canceled',
          eventType: event.type,
          eventId: event.event_id,
        },
        createdAt: now,
      });
      return {
        duplicate: false,
        applied: false,
        ignoredReason: 'already_canceled',
      };
    }

    if (event.type === 'payment.succeeded') {
      const existing = this.invoiceRepo.findByInvoiceId(event.invoice_id);
      if (existing.some((x) => x.status === 'succeeded')) {
        return {
          duplicate: false,
          applied: false,
          ignoredReason: 'already_succeeded_invoice',
        };
      }

      this.invoiceRepo.add({
        invoiceId: event.invoice_id,
        subscriptionId: sub.id,
        amount: event.amount,
        currency: event.currency,
        status: 'succeeded',
        source: 'webhook',
        createdAt: now,
      });

      const trigger =
        sub.status === SubscriptionState.PAST_DUE
          ? TransitionTrigger.RETRY_CHARGE_SUCCEEDED
          : TransitionTrigger.TRIAL_CHARGE_SUCCEEDED;

      if (SubscriptionStateMachine.canTransition(sub.status, trigger)) {
        sub.status = SubscriptionStateMachine.transition(sub.status, trigger);
        sub.updatedAt = now;
        this.subscriptionRepo.save(sub);
      }

      this.auditRepo.add({
        subscriptionId: sub.id,
        action: 'payment.succeeded',
        details: { invoiceId: event.invoice_id, eventId: event.event_id },
        createdAt: now,
      });

      return { duplicate: false, applied: true };
    }

    if (event.type === 'payment.failed') {
      const existing = this.invoiceRepo.findByInvoiceId(event.invoice_id);
      if (existing.some((x) => x.status === 'succeeded')) {
        this.auditRepo.add({
          subscriptionId: sub.id,
          action: 'webhook.ignored',
          details: {
            reason: 'stale_failed_after_success',
            invoiceId: event.invoice_id,
            eventId: event.event_id,
          },
          createdAt: now,
        });
        return {
          duplicate: false,
          applied: false,
          ignoredReason: 'stale_failed_after_success',
        };
      }

      this.invoiceRepo.add({
        invoiceId: event.invoice_id,
        subscriptionId: sub.id,
        amount: event.amount,
        currency: event.currency,
        status: 'failed',
        source: 'webhook',
        createdAt: now,
      });

      const trigger =
        sub.status === SubscriptionState.TRIALING
          ? TransitionTrigger.TRIAL_CHARGE_FAILED
          : TransitionTrigger.RECURRING_CHARGE_FAILED;

      if (SubscriptionStateMachine.canTransition(sub.status, trigger)) {
        sub.status = SubscriptionStateMachine.transition(sub.status, trigger);
        sub.updatedAt = now;
        this.subscriptionRepo.save(sub);
      }

      this.auditRepo.add({
        subscriptionId: sub.id,
        action: 'payment.failed',
        details: { invoiceId: event.invoice_id, eventId: event.event_id },
        createdAt: now,
      });

      return { duplicate: false, applied: true };
    }

    if (event.type === 'payment.refunded') {
      this.auditRepo.add({
        subscriptionId: sub.id,
        action: 'payment.refunded',
        details: { invoiceId: event.invoice_id, eventId: event.event_id },
        createdAt: now,
      });
      return { duplicate: false, applied: true };
    }

    return {
      duplicate: false,
      applied: false,
      ignoredReason: 'unsupported_event',
    };
  }

  async _attemptCharge({
    subscriptionId,
    invoiceId,
    customerId,
    paymentMethodId,
    amount,
    currency,
    reference,
    source,
  }) {
    const now = new Date().toISOString();
    const sub = this.subscriptionRepo.getById(subscriptionId);

    try {
      const result = await this.paymentProvider.charge({
        customerId,
        paymentMethodId,
        amount,
        currency,
        reference,
      });

      if (result.ok) {
        this.invoiceRepo.add({
          invoiceId,
          subscriptionId,
          amount,
          currency,
          status: 'succeeded',
          source,
          createdAt: now,
        });
      } else {
        this.invoiceRepo.add({
          invoiceId,
          subscriptionId,
          amount,
          currency,
          status: 'failed',
          source,
          createdAt: now,
          reason: result.reason,
        });

        if (
          SubscriptionStateMachine.canTransition(
            sub.status,
            TransitionTrigger.RECURRING_CHARGE_FAILED,
          )
        ) {
          sub.status = SubscriptionStateMachine.transition(
            sub.status,
            TransitionTrigger.RECURRING_CHARGE_FAILED,
          );
          sub.updatedAt = now;
          this.subscriptionRepo.save(sub);
        }
      }
    } catch (err) {
      this.invoiceRepo.add({
        invoiceId,
        subscriptionId,
        amount,
        currency,
        status: 'failed',
        source,
        createdAt: now,
        reason: err.code || 'unknown_error',
      });

      if (
        SubscriptionStateMachine.canTransition(
          sub.status,
          TransitionTrigger.RECURRING_CHARGE_FAILED,
        )
      ) {
        sub.status = SubscriptionStateMachine.transition(
          sub.status,
          TransitionTrigger.RECURRING_CHARGE_FAILED,
        );
        sub.updatedAt = now;
        this.subscriptionRepo.save(sub);
      }
    }

    this.auditRepo.add({
      subscriptionId,
      action: 'charge.attempted',
      details: { amount, currency, reference },
      createdAt: now,
    });
  }
}

module.exports = {
  SubscriptionService,
};
