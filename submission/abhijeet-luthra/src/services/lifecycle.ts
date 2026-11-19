import { Clock } from '../clock';
import { nextStatus, SubscriptionTrigger } from '../domain/subscription-state-machine';
import { AppError } from '../domain/errors';
import { AuditTrigger, Subscription } from '../domain/types';
import { IdGenerator } from '../ids';
import { Repositories } from '../repositories';

/**
 * The ONLY code path that changes a subscription's status.
 *
 * Every change goes through the transition table and writes exactly one audit
 * row, so "status mutated ad hoc from six call sites" (assignment anti-pattern)
 * cannot happen. Must be called inside a transaction.
 */
export class Lifecycle {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  canApply(subscription: Subscription, trigger: SubscriptionTrigger): boolean {
    return nextStatus(subscription.status, trigger) !== null;
  }

  /** Applies `trigger`, persists the new status plus `changes`, and appends an audit row. */
  apply(
    subscription: Subscription,
    trigger: SubscriptionTrigger,
    audit: { trigger: AuditTrigger; referenceId: string | null },
    changes: Partial<Pick<Subscription, 'currentPeriodEnd' | 'canceledAt'>> = {},
  ): Subscription {
    const next = nextStatus(subscription.status, trigger);
    if (next === null) {
      throw new AppError(409, 'INVALID_TRANSITION', `Cannot apply ${trigger} to a ${subscription.status} subscription`);
    }
    const now = this.clock.now().toISOString();
    const updated: Subscription = { ...subscription, ...changes, status: next, updatedAt: now };
    this.repos.subscriptions.update(updated);
    this.repos.subscriptionEvents.append({
      id: this.ids.next('sevt'),
      subscriptionId: subscription.id,
      previousStatus: subscription.status,
      newStatus: next,
      trigger: audit.trigger,
      referenceId: audit.referenceId,
      createdAt: now,
    });
    return updated;
  }

  /** Audit row for a brand-new subscription (`null -> trialing`). */
  recordCreation(subscription: Subscription): void {
    this.repos.subscriptionEvents.append({
      id: this.ids.next('sevt'),
      subscriptionId: subscription.id,
      previousStatus: null,
      newStatus: subscription.status,
      trigger: 'api_create',
      referenceId: null,
      createdAt: subscription.createdAt,
    });
  }
}
