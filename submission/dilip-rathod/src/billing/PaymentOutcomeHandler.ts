import type { SubscriptionLifecycle } from '../domain/SubscriptionLifecycle';
import { SubscriptionStateMachine } from '../domain/SubscriptionStateMachine';
import type { LifecycleTrigger } from '../domain/SubscriptionStateMachine';
import type { Invoice, OutcomeResult, OutcomeSource, PaymentAttempt, Subscription } from '../domain/types';
import { applied, ignored } from '../domain/types';
import type { AuditLogRepository, NotificationOutbox } from '../persistence/repositories/EventRepositories';
import type { InvoiceRepository } from '../persistence/repositories/InvoiceRepository';
import type { PaymentAttemptRepository } from '../persistence/repositories/PaymentAttemptRepository';
import type { SubscriptionPatch, SubscriptionRepository } from '../persistence/repositories/SubscriptionRepository';
import type { PlanCatalog } from '../plans/PlanPolicy';
import type { Clock } from '../shared/infrastructure';
import { iso } from '../shared/infrastructure';

export interface OutcomeContext {
  source: OutcomeSource;
  providerChargeId: string | null;
  /** Webhook event id or invoice id: what caused this change, for the audit log. */
  reference: string;
}

/**
 * The single place where a payment outcome — whether it came from the provider's synchronous
 * response or from a webhook — is turned into invoice, attempt and subscription changes.
 * Callers must hold a database transaction.
 */
export class PaymentOutcomeHandler {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly invoices: InvoiceRepository,
    private readonly attempts: PaymentAttemptRepository,
    private readonly audit: AuditLogRepository,
    private readonly outbox: NotificationOutbox,
    private readonly lifecycle: SubscriptionLifecycle,
    private readonly plans: PlanCatalog,
    private readonly clock: Clock,
  ) {}

  recordSuccess(invoice: Invoice, attempt: PaymentAttempt, ctx: OutcomeContext): OutcomeResult {
    if (this.invoices.find(invoice.id)?.status !== 'open') return ignored('invoice_not_open');
    const subscription = this.subscriptions.find(invoice.subscriptionId)!;
    if (!SubscriptionStateMachine.can(subscription.status, 'charge_succeeded')) return ignored('illegal_transition');
    const at = iso(this.clock.now());

    if (!this.attempts.resolve(attempt.id, { status: 'succeeded', providerChargeId: ctx.providerChargeId, declineCode: null, resolvedBy: ctx.source, atIso: at })) {
      return ignored('attempt_already_resolved');
    }
    this.invoices.markPaid(invoice.id, at);

    this.lifecycle.apply(
      subscription,
      'charge_succeeded',
      { currentPeriodStart: invoice.periodStart, currentPeriodEnd: invoice.periodEnd, nextBillingAt: invoice.periodEnd, retryCount: 0 },
      ctx.reference,
      at,
    );
    return applied;
  }

  recordFailure(invoice: Invoice, attempt: PaymentAttempt, declineCode: string, ctx: OutcomeContext): OutcomeResult {
    if (this.invoices.find(invoice.id)?.status !== 'open') return ignored('invoice_not_open');
    const subscription = this.subscriptions.find(invoice.subscriptionId)!;
    const trigger = this.failureTriggerFor(subscription);
    if (!SubscriptionStateMachine.can(subscription.status, trigger)) return ignored('illegal_transition');
    const now = this.clock.now();
    const at = iso(now);

    if (!this.attempts.resolve(attempt.id, { status: 'declined', providerChargeId: ctx.providerChargeId, declineCode, resolvedBy: ctx.source, atIso: at })) {
      return ignored('attempt_already_resolved');
    }

    const plan = this.plans.require(subscription.plan);
    let patch: SubscriptionPatch;
    if (trigger === 'retries_exhausted') {
      this.invoices.close(invoice.id, 'uncollectible', at);
      patch = { retryCount: subscription.retryCount + 1, nextBillingAt: null, canceledAt: at, cancelReason: 'retries_exhausted' };
    } else if (trigger === 'retry_failed') {
      patch = { retryCount: subscription.retryCount + 1, nextBillingAt: iso(plan.nextRetryAt(now)) };
    } else {
      patch = { retryCount: 0, nextBillingAt: iso(plan.nextRetryAt(now)) };
    }

    this.lifecycle.apply(subscription, trigger, patch, ctx.reference, at);
    return applied;
  }

  recordRefund(invoice: Invoice, reference: string): OutcomeResult {
    const at = iso(this.clock.now());
    if (!this.invoices.markRefunded(invoice.id, at)) return ignored('invoice_not_paid');
    const subscription = this.subscriptions.find(invoice.subscriptionId)!;
    this.audit.append({
      subscriptionId: subscription.id,
      eventType: 'invoice_refunded',
      fromStatus: subscription.status,
      toStatus: subscription.status,
      cause: 'payment.refunded',
      reference,
      detail: invoice.id,
      atIso: at,
    });
    this.outbox.enqueue(subscription.id, 'payment_refunded', reference, at);
    return applied;
  }

  private failureTriggerFor(subscription: Subscription): LifecycleTrigger {
    if (subscription.status !== 'past_due') return 'charge_failed';
    const plan = this.plans.require(subscription.plan);
    return subscription.retryCount + 1 >= plan.maxRetries ? 'retries_exhausted' : 'retry_failed';
  }
}
