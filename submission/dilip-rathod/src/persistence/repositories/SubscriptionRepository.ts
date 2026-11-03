import type { LifecycleTrigger, SubscriptionStatus } from '../../domain/SubscriptionStateMachine';
import { SubscriptionStateMachine } from '../../domain/SubscriptionStateMachine';
import type { CancelReason, Subscription } from '../../domain/types';
import { StaleStateError } from '../../shared/errors';
import type { Database, Param } from '../Database';

interface SubscriptionRow {
  id: string;
  customer_id: string;
  payment_method_id: string;
  plan: string;
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  retry_count: number;
  canceled_at: string | null;
  cancel_reason: CancelReason | null;
  created_at: string;
  updated_at: string;
}

/** Columns that may change alongside (or without) a status change. `status` is deliberately absent. */
export interface SubscriptionPatch {
  plan?: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  nextBillingAt?: string | null;
  retryCount?: number;
  canceledAt?: string | null;
  cancelReason?: CancelReason | null;
}

const PATCH_COLUMNS: Record<keyof SubscriptionPatch, string> = {
  plan: 'plan',
  currentPeriodStart: 'current_period_start',
  currentPeriodEnd: 'current_period_end',
  nextBillingAt: 'next_billing_at',
  retryCount: 'retry_count',
  canceledAt: 'canceled_at',
  cancelReason: 'cancel_reason',
};

function toSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    customerId: row.customer_id,
    paymentMethodId: row.payment_method_id,
    plan: row.plan,
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    nextBillingAt: row.next_billing_at,
    retryCount: row.retry_count,
    canceledAt: row.canceled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SubscriptionRepository {
  constructor(private readonly db: Database) {}

  insert(s: Subscription): void {
    this.db.run(
      `INSERT INTO subscriptions (id, customer_id, payment_method_id, plan, status, trial_ends_at,
         current_period_start, current_period_end, next_billing_at, retry_count, canceled_at, cancel_reason,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.id, s.customerId, s.paymentMethodId, s.plan, s.status, s.trialEndsAt,
        s.currentPeriodStart, s.currentPeriodEnd, s.nextBillingAt, s.retryCount, s.canceledAt, s.cancelReason,
        s.createdAt, s.updatedAt,
      ],
    );
  }

  find(id: string): Subscription | undefined {
    const row = this.db.get<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = ?', [id]);
    return row && toSubscription(row);
  }

  findDueForBilling(nowIso: string): Subscription[] {
    return this.db
      .all<SubscriptionRow>(
        `SELECT * FROM subscriptions
         WHERE status IN ('trialing', 'active', 'past_due') AND next_billing_at IS NOT NULL AND next_billing_at <= ?
         ORDER BY next_billing_at, id`,
        [nowIso],
      )
      .map(toSubscription);
  }

  /**
   * The only code path that changes a subscription's status. Callers supply a trigger, never a
   * target status; the state machine decides (and throws on an illegal trigger). The UPDATE is
   * guarded on the status we read so a concurrent change cannot be overwritten.
   */
  applyTransition(current: Subscription, trigger: LifecycleTrigger, patch: SubscriptionPatch, atIso: string): Subscription {
    const to = SubscriptionStateMachine.next(current.status, trigger);
    return this.guardedUpdate(current, { status: to }, patch, atIso);
  }

  /** Changes non-status fields only. */
  update(current: Subscription, patch: SubscriptionPatch, atIso: string): Subscription {
    return this.guardedUpdate(current, {}, patch, atIso);
  }

  private guardedUpdate(
    current: Subscription,
    status: { status?: SubscriptionStatus },
    patch: SubscriptionPatch,
    atIso: string,
  ): Subscription {
    const assignments: string[] = [];
    const params: Param[] = [];
    if (status.status) {
      assignments.push('status = ?');
      params.push(status.status);
    }
    for (const [key, column] of Object.entries(PATCH_COLUMNS) as Array<[keyof SubscriptionPatch, string]>) {
      if (key in patch) {
        assignments.push(`${column} = ?`);
        params.push(patch[key] ?? null);
      }
    }
    assignments.push('updated_at = ?');
    params.push(atIso, current.id, current.status);

    const changed = this.db.run(`UPDATE subscriptions SET ${assignments.join(', ')} WHERE id = ? AND status = ?`, params);
    if (changed !== 1) throw new StaleStateError('subscription', current.id);
    return this.find(current.id)!;
  }
}
