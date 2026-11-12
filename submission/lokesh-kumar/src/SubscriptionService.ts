import { PLANS, findPlan } from './domain/plans.js';
import { SubscriptionStateMachine } from './domain/SubscriptionStateMachine.js';
import type { SubscriptionEvent, SubscriptionState } from './domain/SubscriptionStateMachine.js';
import type { Invoice, Subscription, WebhookOutcome } from './domain/types.js';
import { ApiError } from './errors.js';
import { ProviderTimeoutError } from './payment/PaymentProvider.js';
import type { PaymentProvider } from './payment/PaymentProvider.js';
import type {
  AuditLogRepository,
  CustomerRepository,
  InvoiceRepository,
  SubscriptionRepository,
  WebhookEventRepository,
} from './persistence/repositories.js';
import type { WebhookPayload } from './webhook/payload.js';

export interface ServiceDeps {
  subscriptions: SubscriptionRepository;
  invoices: InvoiceRepository;
  webhookEvents: WebhookEventRepository;
  auditLog: AuditLogRepository;
  customers: CustomerRepository;
  provider: PaymentProvider;
  now: () => Date;
  /** Consecutive failed charges after which a past_due subscription is canceled. */
  maxFailedAttempts: number;
}

export interface BillingResult {
  subscription: Subscription;
  invoice: Invoice;
}

export interface WebhookResult {
  status: 'applied' | 'ignored' | 'duplicate';
  outcome?: WebhookOutcome;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError(400, 'validation_error', `${field} is required`);
  }
  return value;
}

/**
 * Minimal Subscription & Billing service used as the system under test.
 *
 * Design rule: `transition()` is the ONLY place a subscription status is changed, and it
 * always goes through SubscriptionStateMachine and writes an audit entry.
 */
export class SubscriptionService {
  private readonly deps: ServiceDeps;
  private readonly machine = new SubscriptionStateMachine();

  constructor(deps: ServiceDeps) {
    this.deps = deps;
  }

  // ---------------------------------------------------------------- API operations

  async createSubscription(input: unknown): Promise<Subscription> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new ApiError(400, 'validation_error', 'body must be a JSON object');
    }
    const body = input as Record<string, unknown>;
    const customerId = requireString(body, 'customer_id');
    const planName = requireString(body, 'plan');
    const paymentMethodId = requireString(body, 'payment_method_id');
    if (!paymentMethodId.startsWith('pm_')) {
      throw new ApiError(400, 'validation_error', 'payment_method_id is invalid');
    }
    const plan = findPlan(planName);
    if (!plan) {
      throw new ApiError(400, 'invalid_plan', `unknown plan: ${planName}`);
    }
    if (!this.deps.customers.exists(customerId)) {
      throw new ApiError(404, 'customer_not_found', `unknown customer: ${customerId}`);
    }

    const now = this.deps.now();
    const subscription: Subscription = {
      id: this.deps.subscriptions.nextId(),
      customerId,
      plan: plan.id,
      paymentMethodId,
      status: 'trialing',
      failedAttempts: 0,
      trialEndsAt: plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * DAY_MS).toISOString() : null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    this.deps.subscriptions.save(subscription);
    this.deps.auditLog.append({
      subscriptionId: subscription.id,
      from: null,
      to: 'trialing',
      trigger: 'created',
      at: now.toISOString(),
    });

    // A plan without a trial is charged immediately: its "trial" ends at creation.
    if (plan.trialDays === 0) {
      await this.runBilling(subscription.id);
    }
    return this.requireSubscription(subscription.id);
  }

  getSubscription(id: string): Subscription {
    return this.requireSubscription(id);
  }

  cancelSubscription(id: string): Subscription {
    const subscription = this.requireSubscription(id);
    if (!this.canApply(subscription.status, 'cancel')) {
      throw new ApiError(409, 'invalid_transition', `cannot cancel a ${subscription.status} subscription`);
    }
    this.transition(subscription, 'cancel', 'api_cancel');
    return this.requireSubscription(id);
  }

  /**
   * Runs one billing attempt (trial end, recurring charge, or dunning retry depending on the
   * current state). Exposed over HTTP as an internal endpoint so tests can drive time-based
   * billing deterministically instead of waiting for a scheduler.
   */
  async runBilling(id: string): Promise<BillingResult> {
    const subscription = this.requireSubscription(id);
    if (subscription.status === 'canceled') {
      throw new ApiError(409, 'subscription_canceled', 'canceled subscriptions are never billed');
    }

    const plan = PLANS[subscription.plan];
    const now = this.deps.now().toISOString();
    const invoiceId = this.deps.invoices.nextId();
    const invoice: Invoice = {
      id: invoiceId,
      subscriptionId: subscription.id,
      amount: plan.priceCents,
      currency: plan.currency,
      status: 'pending',
      failureReason: null,
      providerChargeId: null,
      idempotencyKey: `${subscription.id}:${invoiceId}`,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
    };
    this.deps.invoices.save(invoice);

    try {
      const result = await this.deps.provider.charge({
        customerId: subscription.customerId,
        paymentMethodId: subscription.paymentMethodId,
        amount: invoice.amount,
        currency: invoice.currency,
        idempotencyKey: invoice.idempotencyKey,
      });
      if (result.outcome === 'succeeded') {
        this.settleSuccess(subscription.id, invoice.id, result.chargeId, 'charge_succeeded');
      } else {
        this.settleFailure(subscription.id, invoice.id, result.declineReason ?? 'declined', 'charge_declined');
      }
    } catch (error) {
      // Timeout: we do not know whether the customer was charged. The invoice stays
      // `pending` and the provider's webhook will settle it later.
      if (!(error instanceof ProviderTimeoutError)) throw error;
    }

    return {
      subscription: this.requireSubscription(id),
      invoice: this.deps.invoices.get(invoice.id)!,
    };
  }

  // ---------------------------------------------------------------- webhooks

  /**
   * Synchronous on purpose: the duplicate check, validation and state change happen with no
   * `await` in between, so two deliveries cannot interleave inside this process.
   */
  handleWebhook(payload: WebhookPayload): WebhookResult {
    const existing = this.deps.webhookEvents.get(payload.event_id);
    if (existing) {
      existing.deliveryCount += 1;
      this.deps.webhookEvents.save(existing);
      return { status: 'duplicate' };
    }

    const subscription = this.deps.subscriptions.get(payload.subscription_id);
    if (!subscription) {
      throw new ApiError(404, 'subscription_not_found', `unknown subscription: ${payload.subscription_id}`);
    }
    const invoice = this.deps.invoices.get(payload.invoice_id);
    if (!invoice || invoice.subscriptionId !== subscription.id) {
      throw new ApiError(404, 'invoice_not_found', `invoice ${payload.invoice_id} does not belong to this subscription`);
    }
    if (invoice.amount !== payload.amount || invoice.currency !== payload.currency) {
      throw new ApiError(422, 'amount_mismatch', 'amount/currency does not match the invoice');
    }

    const outcome = this.applyWebhook(subscription, invoice, payload);
    this.deps.webhookEvents.save({
      eventId: payload.event_id,
      type: payload.type,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      outcome,
      deliveryCount: 1,
      receivedAt: this.deps.now().toISOString(),
    });
    return { status: outcome === 'applied' ? 'applied' : 'ignored', outcome };
  }

  private applyWebhook(subscription: Subscription, invoice: Invoice, payload: WebhookPayload): WebhookOutcome {
    const trigger = `webhook:${payload.type}`;

    if (payload.type === 'payment.refunded') {
      if (invoice.status !== 'paid') return 'ignored_invalid_transition';
      invoice.status = 'refunded';
      invoice.updatedAt = this.deps.now().toISOString();
      this.deps.invoices.save(invoice);
      return 'applied';
    }

    // Cancellation is final: no webhook can revive or modify a canceled subscription.
    if (subscription.status === 'canceled') return 'ignored_canceled';

    // A settled invoice never changes again, so late or contradictory events are stale.
    if (invoice.status !== 'pending') return 'ignored_stale';

    if (payload.type === 'payment.succeeded') {
      this.settleSuccess(subscription.id, invoice.id, null, trigger);
    } else {
      this.settleFailure(subscription.id, invoice.id, 'payment_failed', trigger);
    }
    return 'applied';
  }

  // ---------------------------------------------------------------- settlement

  private settleSuccess(subscriptionId: string, invoiceId: string, chargeId: string | null, trigger: string): void {
    const now = this.deps.now().toISOString();
    const invoice = this.deps.invoices.get(invoiceId)!;
    invoice.status = 'paid';
    invoice.paidAt = now;
    invoice.updatedAt = now;
    invoice.providerChargeId = chargeId ?? invoice.providerChargeId;
    this.deps.invoices.save(invoice);

    const subscription = this.requireSubscription(subscriptionId);
    if (subscription.status === 'canceled') return;
    subscription.failedAttempts = 0;
    if (this.canApply(subscription.status, 'charge_succeeded')) {
      this.transition(subscription, 'charge_succeeded', trigger);
    } else {
      // e.g. an active subscription's renewal being confirmed: nothing to change.
      subscription.updatedAt = now;
      this.deps.subscriptions.save(subscription);
    }
  }

  private settleFailure(subscriptionId: string, invoiceId: string, reason: string, trigger: string): void {
    const now = this.deps.now().toISOString();
    const invoice = this.deps.invoices.get(invoiceId)!;
    invoice.status = 'failed';
    invoice.failureReason = reason;
    invoice.updatedAt = now;
    this.deps.invoices.save(invoice);

    const subscription = this.requireSubscription(subscriptionId);
    if (subscription.status === 'canceled') return;
    subscription.failedAttempts += 1;

    if (this.canApply(subscription.status, 'charge_failed')) {
      this.transition(subscription, 'charge_failed', trigger);
    } else if (
      subscription.status === 'past_due' &&
      subscription.failedAttempts >= this.deps.maxFailedAttempts
    ) {
      this.transition(subscription, 'retries_exhausted', trigger);
    } else {
      // past_due and retries remain: record the attempt, stay past_due.
      subscription.updatedAt = now;
      this.deps.subscriptions.save(subscription);
    }
  }

  // ---------------------------------------------------------------- the only status mutation

  private transition(subscription: Subscription, event: SubscriptionEvent, trigger: string): void {
    const from = subscription.status;
    const result = this.machine.transition(from, event);
    if (!result.ok) {
      // Callers check canApply() first, so reaching this is a bug in the service, not a client error.
      throw new Error(result.reason);
    }
    const at = this.deps.now().toISOString();
    subscription.status = result.state;
    subscription.updatedAt = at;
    this.deps.subscriptions.save(subscription);
    this.deps.auditLog.append({ subscriptionId: subscription.id, from, to: result.state, trigger, at });
  }

  private canApply(state: SubscriptionState, event: SubscriptionEvent): boolean {
    return this.machine.transition(state, event).ok;
  }

  private requireSubscription(id: string): Subscription {
    const subscription = this.deps.subscriptions.get(id);
    if (!subscription) {
      throw new ApiError(404, 'subscription_not_found', `unknown subscription: ${id}`);
    }
    return subscription;
  }
}
