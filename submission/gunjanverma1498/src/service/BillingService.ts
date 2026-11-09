import type { PlanCatalog } from '../domain/plans';
import { SubscriptionStateMachine } from '../domain/stateMachine';
import type {
  AuditEvent,
  Invoice,
  LifecycleEvent,
  Subscription,
  SubscriptionStatus,
  WebhookEventType,
} from '../domain/types';
import {
  PaymentProviderTimeoutError,
  type PaymentProvider,
} from '../payments/PaymentProvider';
import { verifySignature } from '../payments/signature';
import type { Database } from '../persistence/repositories';
import type { Clock } from '../support/clock';
import { generateId } from '../support/ids';
import { ConflictError, NotFoundError, SignatureError, ValidationError } from './errors';

export interface CreateSubscriptionInput {
  customerId: string;
  plan: string;
  paymentMethodId: string;
}

export interface WebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export type WebhookOutcome = 'processed' | 'duplicate_ignored' | 'ignored';

export interface WebhookResult {
  outcome: WebhookOutcome;
  subscriptionStatus?: SubscriptionStatus;
  reason: string;
}

export interface BillingServiceDeps {
  db: Database;
  paymentProvider: PaymentProvider;
  plans: PlanCatalog;
  clock: Clock;
  webhookSecret: string;
  maxRetries?: number;
}

const WEBHOOK_EVENT_TO_LIFECYCLE: Record<WebhookEventType, LifecycleEvent> = {
  'payment.succeeded': 'CHARGE_SUCCEEDED',
  'payment.failed': 'CHARGE_FAILED',
  'payment.refunded': 'REFUND',
};

/**
 * Orchestrates subscription/billing behavior. It owns no status-mutation logic
 * of its own: every lifecycle change is routed through {@link SubscriptionStateMachine},
 * every charge through the injected {@link PaymentProvider}, and every write
 * through the repositories. That separation is what the test framework verifies.
 */
export class BillingService {
  private readonly db: Database;
  private readonly provider: PaymentProvider;
  private readonly plans: PlanCatalog;
  private readonly clock: Clock;
  private readonly webhookSecret: string;
  private readonly maxRetries: number;
  private readonly stateMachine = new SubscriptionStateMachine();
  private auditSeq = 0;

  constructor(deps: BillingServiceDeps) {
    this.db = deps.db;
    this.provider = deps.paymentProvider;
    this.plans = deps.plans;
    this.clock = deps.clock;
    this.webhookSecret = deps.webhookSecret;
    this.maxRetries = deps.maxRetries ?? 3;
  }

  // ---------------------------------------------------------------- API ops

  async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    this.validateCreateInput(input);

    const customer = this.db.customers.findById(input.customerId);
    if (!customer) {
      throw new NotFoundError('customer_not_found', `unknown customer ${input.customerId}`);
    }
    if (!this.plans.has(input.plan)) {
      throw new ValidationError('unknown_plan', `unknown plan ${input.plan}`);
    }
    if (!customer.paymentMethodIds.includes(input.paymentMethodId)) {
      throw new ValidationError(
        'invalid_payment_method',
        `payment method ${input.paymentMethodId} not on file for customer`,
      );
    }

    const plan = this.plans.get(input.plan);
    const now = this.timestamp();

    let subscription: Subscription = {
      id: generateId('sub'),
      customerId: input.customerId,
      planId: plan.id,
      paymentMethodId: input.paymentMethodId,
      status: 'trialing',
      trialEndAt: null,
      failedChargeCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    if (plan.startsWithTrial) {
      subscription.trialEndAt = this.addDays(now, plan.trialDays);
      subscription = this.db.subscriptions.insert(subscription);
      this.recordAudit(subscription.id, 'subscription.created', null, 'trialing', {
        plan: plan.id,
        trialEndAt: subscription.trialEndAt,
      });
      return subscription;
    }

    // Immediate-charge plan: persist first, then attempt the initial charge.
    subscription = this.db.subscriptions.insert(subscription);
    this.recordAudit(subscription.id, 'subscription.created', null, 'trialing', {
      plan: plan.id,
    });

    const invoice = this.openInvoice(subscription.id, plan.price, plan.currency);
    return this.attemptInitialCharge(subscription, invoice, customer.id, input.paymentMethodId);
  }

  getSubscription(id: string): Subscription {
    const subscription = this.db.subscriptions.findById(id);
    if (!subscription) {
      throw new NotFoundError('subscription_not_found', `unknown subscription ${id}`);
    }
    return subscription;
  }

  cancelSubscription(id: string): Subscription {
    const subscription = this.getSubscription(id);
    if (subscription.status === 'canceled') {
      throw new ConflictError('already_canceled', `subscription ${id} is already canceled`);
    }

    const result = this.stateMachine.apply(subscription.status, 'CANCEL', {
      failedChargeCount: subscription.failedChargeCount,
      maxRetries: this.maxRetries,
    });
    const updated = this.commitTransition(subscription, result.toStatus);
    this.recordAudit(id, 'subscription.canceled', result.fromStatus, result.toStatus, {
      via: 'api',
    });
    return updated;
  }

  // ------------------------------------------------------------- webhook op

  async processWebhook(rawBody: string, signature: string | undefined): Promise<WebhookResult> {
    if (!verifySignature(rawBody, signature, this.webhookSecret)) {
      throw new SignatureError();
    }

    const payload = this.parseAndValidateWebhook(rawBody);

    // Exact redelivery: the event_id is already recorded -> no-op.
    if (this.db.webhookEvents.has(payload.event_id)) {
      return { outcome: 'duplicate_ignored', reason: 'event_id already processed' };
    }

    const subscription = this.db.subscriptions.findById(payload.subscription_id);
    if (!subscription) {
      throw new NotFoundError(
        'subscription_not_found',
        `webhook for unknown subscription ${payload.subscription_id}`,
      );
    }

    // Claim idempotency before mutating anything else, so even a no-op outcome is
    // never reprocessed on redelivery.
    this.db.webhookEvents.insert({
      eventId: payload.event_id,
      type: payload.type,
      subscriptionId: payload.subscription_id,
      invoiceId: payload.invoice_id,
      receivedAt: this.timestamp(),
    });

    // Terminal subscriptions ignore all webhooks (cancellation is irreversible).
    if (subscription.status === 'canceled') {
      this.recordAudit(subscription.id, `${payload.type}.ignored`, 'canceled', 'canceled', {
        reason: 'subscription canceled',
        eventId: payload.event_id,
      });
      return {
        outcome: 'ignored',
        subscriptionStatus: 'canceled',
        reason: 'subscription is canceled',
      };
    }

    return this.applyWebhook(subscription, payload);
  }

  // --------------------------------------------------------------- internals

  private applyWebhook(subscription: Subscription, payload: WebhookPayload): WebhookResult {
    const existingInvoice = this.db.invoices.findById(payload.invoice_id);

    // Out-of-order / stale protection keyed on invoice state. An already-paid
    // invoice cannot be failed or re-paid by a later event for the same invoice.
    if (existingInvoice?.status === 'paid') {
      if (payload.type === 'payment.succeeded') {
        this.recordAudit(subscription.id, 'payment.succeeded.ignored', subscription.status, subscription.status, {
          reason: 'invoice already paid',
          invoiceId: payload.invoice_id,
        });
        return {
          outcome: 'ignored',
          subscriptionStatus: subscription.status,
          reason: 'invoice already paid',
        };
      }
      if (payload.type === 'payment.failed') {
        this.recordAudit(subscription.id, 'payment.failed.ignored', subscription.status, subscription.status, {
          reason: 'stale failure after successful payment',
          invoiceId: payload.invoice_id,
        });
        return {
          outcome: 'ignored',
          subscriptionStatus: subscription.status,
          reason: 'stale failure for already-paid invoice',
        };
      }
    }

    const lifecycleEvent = WEBHOOK_EVENT_TO_LIFECYCLE[payload.type];
    const result = this.stateMachine.apply(subscription.status, lifecycleEvent, {
      failedChargeCount: subscription.failedChargeCount,
      maxRetries: this.maxRetries,
    });

    // Persist the invoice side effect for this billing attempt.
    this.recordInvoiceForWebhook(subscription.id, payload, existingInvoice);

    // Persist the lifecycle side effect.
    const failedChargeCount =
      payload.type === 'payment.failed'
        ? subscription.failedChargeCount + 1
        : payload.type === 'payment.succeeded'
          ? 0
          : subscription.failedChargeCount;

    const updated = this.commitTransition(subscription, result.toStatus, failedChargeCount);
    this.recordAudit(subscription.id, payload.type, result.fromStatus, result.toStatus, {
      eventId: payload.event_id,
      invoiceId: payload.invoice_id,
      changed: result.changed,
      reason: result.reason,
    });

    return {
      outcome: 'processed',
      subscriptionStatus: updated.status,
      reason: result.reason,
    };
  }

  private recordInvoiceForWebhook(
    subscriptionId: string,
    payload: WebhookPayload,
    existing: Invoice | undefined,
  ): void {
    const now = this.timestamp();
    const base: Invoice = existing ?? {
      id: payload.invoice_id,
      subscriptionId,
      amount: payload.amount,
      currency: payload.currency,
      status: 'open',
      providerChargeId: null,
      createdAt: now,
      updatedAt: now,
    };

    switch (payload.type) {
      case 'payment.succeeded':
        this.db.invoices.upsert({
          ...base,
          amount: payload.amount,
          currency: payload.currency,
          status: 'paid',
          providerChargeId: base.providerChargeId ?? generateId('ch'),
          updatedAt: now,
        });
        break;
      case 'payment.failed':
        this.db.invoices.upsert({ ...base, status: 'failed', updatedAt: now });
        break;
      case 'payment.refunded':
        // Only a previously-paid invoice can be refunded.
        if (existing?.status === 'paid') {
          this.db.invoices.upsert({ ...base, status: 'refunded', updatedAt: now });
        }
        break;
    }
  }

  private async attemptInitialCharge(
    subscription: Subscription,
    invoice: Invoice,
    customerId: string,
    paymentMethodId: string,
  ): Promise<Subscription> {
    const plan = this.plans.get(subscription.planId);
    let charged: { success: boolean; providerChargeId?: string; failureCode?: string };

    try {
      charged = await this.provider.charge({
        customerId,
        paymentMethodId,
        amount: plan.price,
        currency: plan.currency,
        idempotencyKey: invoice.id,
      });
    } catch (err) {
      const reason = err instanceof PaymentProviderTimeoutError ? 'timeout' : 'provider_error';
      return this.settleInitialCharge(subscription, invoice, { success: false, failureCode: reason });
    }

    return this.settleInitialCharge(subscription, invoice, charged);
  }

  private settleInitialCharge(
    subscription: Subscription,
    invoice: Invoice,
    charged: { success: boolean; providerChargeId?: string; failureCode?: string },
  ): Subscription {
    const now = this.timestamp();
    const event: LifecycleEvent = charged.success ? 'CHARGE_SUCCEEDED' : 'CHARGE_FAILED';
    const result = this.stateMachine.apply(subscription.status, event, {
      failedChargeCount: subscription.failedChargeCount,
      maxRetries: this.maxRetries,
    });

    if (charged.success) {
      this.db.invoices.upsert({
        ...invoice,
        status: 'paid',
        providerChargeId: charged.providerChargeId ?? generateId('ch'),
        updatedAt: now,
      });
      const updated = this.commitTransition(subscription, result.toStatus, 0);
      this.recordAudit(subscription.id, 'payment.succeeded', result.fromStatus, result.toStatus, {
        invoiceId: invoice.id,
        via: 'initial_charge',
      });
      return updated;
    }

    this.db.invoices.upsert({ ...invoice, status: 'failed', updatedAt: now });
    const updated = this.commitTransition(subscription, result.toStatus, subscription.failedChargeCount + 1);
    this.recordAudit(subscription.id, 'payment.failed', result.fromStatus, result.toStatus, {
      invoiceId: invoice.id,
      failureCode: charged.failureCode,
      via: 'initial_charge',
    });
    return updated;
  }

  private commitTransition(
    subscription: Subscription,
    toStatus: SubscriptionStatus,
    failedChargeCount?: number,
  ): Subscription {
    return this.db.subscriptions.upsert({
      ...subscription,
      status: toStatus,
      failedChargeCount: failedChargeCount ?? subscription.failedChargeCount,
      updatedAt: this.timestamp(),
    });
  }

  private openInvoice(subscriptionId: string, amount: number, currency: string): Invoice {
    const now = this.timestamp();
    return this.db.invoices.insert({
      id: generateId('inv'),
      subscriptionId,
      amount,
      currency,
      status: 'open',
      providerChargeId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  private recordAudit(
    subscriptionId: string,
    type: string,
    fromStatus: SubscriptionStatus | null,
    toStatus: SubscriptionStatus | null,
    metadata: Record<string, unknown>,
  ): AuditEvent {
    this.auditSeq += 1;
    const id = `aud_${String(this.auditSeq).padStart(8, '0')}`;
    return this.db.eventLog.insert({
      id,
      subscriptionId,
      type,
      fromStatus,
      toStatus,
      metadata,
      createdAt: this.timestamp(),
    });
  }

  private validateCreateInput(input: CreateSubscriptionInput): void {
    const missing: string[] = [];
    if (!input || typeof input !== 'object') {
      throw new ValidationError('validation_error', 'request body must be an object');
    }
    if (!input.customerId) missing.push('customer_id');
    if (!input.plan) missing.push('plan');
    if (!input.paymentMethodId) missing.push('payment_method_id');
    if (missing.length > 0) {
      throw new ValidationError('validation_error', `missing required fields: ${missing.join(', ')}`);
    }
  }

  private parseAndValidateWebhook(rawBody: string): WebhookPayload {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new ValidationError('malformed_payload', 'webhook body is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new ValidationError('malformed_payload', 'webhook body must be a JSON object');
    }
    const p = parsed as Record<string, unknown>;
    const validTypes: WebhookEventType[] = ['payment.succeeded', 'payment.failed', 'payment.refunded'];

    if (typeof p.event_id !== 'string' || p.event_id.length === 0) {
      throw new ValidationError('malformed_payload', 'event_id is required');
    }
    if (typeof p.type !== 'string' || !validTypes.includes(p.type as WebhookEventType)) {
      throw new ValidationError('malformed_payload', `type must be one of ${validTypes.join(', ')}`);
    }
    if (typeof p.subscription_id !== 'string' || p.subscription_id.length === 0) {
      throw new ValidationError('malformed_payload', 'subscription_id is required');
    }
    if (typeof p.invoice_id !== 'string' || p.invoice_id.length === 0) {
      throw new ValidationError('malformed_payload', 'invoice_id is required');
    }
    if (typeof p.amount !== 'number' || !Number.isFinite(p.amount)) {
      throw new ValidationError('malformed_payload', 'amount must be a number');
    }
    if (typeof p.currency !== 'string' || p.currency.length === 0) {
      throw new ValidationError('malformed_payload', 'currency is required');
    }

    return {
      event_id: p.event_id,
      type: p.type as WebhookEventType,
      subscription_id: p.subscription_id,
      invoice_id: p.invoice_id,
      amount: p.amount,
      currency: p.currency,
    };
  }

  private timestamp(): string {
    return this.clock.now().toISOString();
  }

  private addDays(fromIso: string, days: number): string {
    return new Date(new Date(fromIso).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  }
}
