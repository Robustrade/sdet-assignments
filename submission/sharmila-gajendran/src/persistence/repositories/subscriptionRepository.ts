import { NotFoundError, StaleStateError } from '../../domain/errors';
import type { Transition } from '../../domain/subscriptionStateMachine';
import type { Subscription, SubscriptionStatus } from '../../domain/types';
import type { Db } from '../database';

interface SubscriptionRow {
  id: string;
  customer_id: string;
  payment_method_id: string;
  plan: string;
  status: string;
  trial_ends_at: string;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    customerId: row.customer_id,
    paymentMethodId: row.payment_method_id,
    plan: row.plan,
    status: row.status as SubscriptionStatus,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface NewSubscription {
  readonly id: string;
  readonly customerId: string;
  readonly paymentMethodId: string;
  readonly plan: string;
  readonly trialEndsAt: string;
  readonly createdAt: string;
}

/** Fields that may change together with a status. Left out = keep the current value. */
export interface SubscriptionPatch {
  readonly currentPeriodEnd?: string;
  readonly canceledAt?: string;
}

export class SubscriptionRepository {
  constructor(private readonly db: Db) {}

  /** New subscriptions always start in 'trialing'; there is no way to insert any other status. */
  insertTrialing(subscription: NewSubscription): void {
    this.db
      .prepare(
        `INSERT INTO subscriptions
           (id, customer_id, payment_method_id, plan, status, trial_ends_at, current_period_end, canceled_at, created_at, updated_at)
         VALUES
           (@id, @customerId, @paymentMethodId, @plan, 'trialing', @trialEndsAt, NULL, NULL, @createdAt, @createdAt)`,
      )
      .run({
        id: subscription.id,
        customerId: subscription.customerId,
        paymentMethodId: subscription.paymentMethodId,
        plan: subscription.plan,
        trialEndsAt: subscription.trialEndsAt,
        createdAt: subscription.createdAt,
      });
  }

  findById(id: string): Subscription | undefined {
    const row = this.db.prepare('SELECT * FROM subscriptions WHERE id = @id').get({ id }) as SubscriptionRow | undefined;
    return row ? toSubscription(row) : undefined;
  }

  getById(id: string): Subscription {
    const subscription = this.findById(id);
    if (!subscription) {
      throw new NotFoundError(`Subscription '${id}' does not exist`, 'SUBSCRIPTION_NOT_FOUND');
    }
    return subscription;
  }

  findAll(): Subscription[] {
    const rows = this.db.prepare('SELECT * FROM subscriptions ORDER BY rowid').all() as SubscriptionRow[];
    return rows.map(toSubscription);
  }

  /** Trials that have ended, active periods that have ended, and every past_due subscription (for a retry). */
  findDueForBilling(now: string): Subscription[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM subscriptions
          WHERE (status = 'trialing' AND trial_ends_at <= @now)
             OR (status = 'active' AND current_period_end <= @now)
             OR status = 'past_due'
          ORDER BY rowid`,
      )
      .all({ now }) as SubscriptionRow[];
    return rows.map(toSubscription);
  }

  /**
   * The only way to change a status. It needs a Transition, which only the state machine
   * can create, and it only updates the row if the status is still the one we read.
   */
  applyTransition(current: Subscription, transition: Transition, patch: SubscriptionPatch, updatedAt: string): void {
    if (current.status !== transition.from) {
      throw new StaleStateError('Subscription', current.id);
    }
    const result = this.db
      .prepare(
        `UPDATE subscriptions
            SET status = @to, current_period_end = @currentPeriodEnd, canceled_at = @canceledAt, updated_at = @updatedAt
          WHERE id = @id AND status = @from`,
      )
      .run({
        id: current.id,
        from: transition.from,
        to: transition.to,
        currentPeriodEnd: patch.currentPeriodEnd ?? current.currentPeriodEnd,
        canceledAt: patch.canceledAt ?? current.canceledAt,
        updatedAt,
      });
    if (result.changes !== 1) {
      throw new StaleStateError('Subscription', current.id);
    }
  }

  /** Renewal: moves the paid period of an active subscription forward. Not a status change. */
  extendActivePeriod(id: string, currentPeriodEnd: string, updatedAt: string): void {
    const result = this.db
      .prepare(
        `UPDATE subscriptions SET current_period_end = @currentPeriodEnd, updated_at = @updatedAt
          WHERE id = @id AND status = 'active'`,
      )
      .run({ id, currentPeriodEnd, updatedAt });
    if (result.changes !== 1) {
      throw new StaleStateError('Subscription', id);
    }
  }
}
