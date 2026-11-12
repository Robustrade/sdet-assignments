import type { Clock } from '../domain/clock';
import type { PlanCatalog } from '../domain/plans';
import { SubscriptionStateMachine } from '../domain/subscriptionStateMachine';
import type { Invoice } from '../domain/types';
import type { Repositories } from '../persistence/repositories';
import type { ChangeContext, SubscriptionLifecycle } from './subscriptionLifecycle';

export type SettlementOutcome = 'processed' | 'ignored_stale' | 'ignored_invalid_transition';

/**
 * Applies the result of a charge to the invoice and the subscription.
 * Used by both the billing run (synchronous provider answer) and webhooks (asynchronous answer),
 * so both paths follow exactly the same rules. Must be called inside a DB transaction.
 *
 * Rules:
 * - Only a pending invoice can be settled. A second result for the same invoice is stale.
 * - The state machine decides whether the subscription may move; if not, nothing changes.
 */
export class PaymentSettlement {
  constructor(
    private readonly repos: Repositories,
    private readonly lifecycle: SubscriptionLifecycle,
    private readonly plans: PlanCatalog,
    private readonly clock: Clock,
    private readonly maxFailedAttempts: number,
  ) {}

  settleSucceeded(invoice: Invoice, providerChargeId: string | null, context: ChangeContext): SettlementOutcome {
    if (invoice.status !== 'pending') {
      return 'ignored_stale';
    }
    const subscription = this.repos.subscriptions.getById(invoice.subscriptionId);
    const plan = this.plans.get(subscription.plan);
    const now = this.clock.now();

    if (subscription.status === 'active') {
      // Renewal: no status change, the paid period moves forward from where it ended.
      this.repos.invoices.markPaid(invoice.id, providerChargeId, now.toISOString());
      const periodStart = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : now;
      this.repos.subscriptions.extendActivePeriod(subscription.id, plan.periodEndFrom(periodStart).toISOString(), now.toISOString());
      this.lifecycle.recordEvent(subscription, 'renewal_succeeded', context);
      return 'processed';
    }

    if (!SubscriptionStateMachine.canApply(subscription.status, 'charge_succeeded')) {
      return 'ignored_invalid_transition';
    }
    this.repos.invoices.markPaid(invoice.id, providerChargeId, now.toISOString());
    this.lifecycle.apply(subscription, 'charge_succeeded', context, {
      currentPeriodEnd: plan.periodEndFrom(now).toISOString(),
    });
    return 'processed';
  }

  settleFailed(invoice: Invoice, providerChargeId: string | null, reason: string, context: ChangeContext): SettlementOutcome {
    if (invoice.status !== 'pending') {
      return 'ignored_stale';
    }
    const subscription = this.repos.subscriptions.getById(invoice.subscriptionId);
    const isRetry = subscription.status === 'past_due';
    if (!isRetry && !SubscriptionStateMachine.canApply(subscription.status, 'charge_failed')) {
      return 'ignored_invalid_transition';
    }

    const now = this.clock.now().toISOString();
    this.repos.invoices.markFailed(invoice.id, providerChargeId, reason, now);

    if (!isRetry) {
      this.lifecycle.apply(subscription, 'charge_failed', context);
      return 'processed';
    }

    // Counted from invoice rows, so a duplicate webhook can never count the same failure twice.
    const failures = this.repos.invoices.countConsecutiveFailures(subscription.id);
    if (failures >= this.maxFailedAttempts) {
      this.lifecycle.apply(subscription, 'retries_exhausted', context, { canceledAt: now });
    } else {
      this.lifecycle.recordEvent(subscription, 'retry_failed', context);
    }
    return 'processed';
  }

  settleRefunded(invoice: Invoice, context: ChangeContext): SettlementOutcome {
    if (invoice.status !== 'paid') {
      return 'ignored_stale';
    }
    const subscription = this.repos.subscriptions.getById(invoice.subscriptionId);
    this.repos.invoices.markRefunded(invoice.id, this.clock.now().toISOString());
    this.lifecycle.recordEvent(subscription, 'payment_refunded', context);
    return 'processed';
  }
}
