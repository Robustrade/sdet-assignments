import type { Status, Transition } from '../domain/SubscriptionStateMachine';
import { inTransaction, one, type Db } from './database';

export type AuditSource = 'api' | 'webhook' | 'billing';

export interface SubscriptionRecord {
  id: string;
  customerId: string;
  plan: string;
  paymentMethodId: string;
  status: Status;
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  retryCount: number;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeContext {
  source: AuditSource;
  reference: string | null;
  at: Date;
}

/** Billing bookkeeping that is not a lifecycle change. Deliberately has no status field. */
export interface BillingFields {
  retryCount?: number;
  currentPeriodEnd?: string;
}

export class StaleStateError extends Error {
  override readonly name = 'StaleStateError';
}

interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan: string;
  payment_method_id: string;
  status: Status;
  trial_ends_at: string;
  current_period_end: string | null;
  retry_count: number;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export class SubscriptionRepository {
  constructor(private readonly db: Db) {}

  find(id: string): SubscriptionRecord | undefined {
    const row = one<SubscriptionRow>(this.db, 'SELECT * FROM subscriptions WHERE id = ?', id);
    return row && toRecord(row);
  }

  /** Every subscription is born trialing (STRATEGY.md §3); the audit log starts here. */
  create(
    sub: { id: string; customerId: string; plan: string; paymentMethodId: string; trialEndsAt: string },
    ctx: ChangeContext,
  ): SubscriptionRecord {
    const at = ctx.at.toISOString();
    inTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO subscriptions (id, customer_id, plan, payment_method_id, status, trial_ends_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'trialing', ?, ?, ?)`,
        )
        .run(sub.id, sub.customerId, sub.plan, sub.paymentMethodId, sub.trialEndsAt, at, at);
      this.audit(sub.id, null, 'trialing', 'CREATED', ctx);
    });
    return this.find(sub.id)!;
  }

  /**
   * The only way to change status. Takes a Transition, which only the state machine can
   * issue, and applies it only if the row is still in transition.from — a compare-and-set
   * that turns a lost race into an error instead of a silent overwrite.
   */
  applyTransition(id: string, transition: Transition, ctx: ChangeContext, fields: BillingFields = {}): void {
    const at = ctx.at.toISOString();
    inTransaction(this.db, () => {
      const result = this.db
        .prepare(
          `UPDATE subscriptions SET
             status = ?, updated_at = ?,
             canceled_at = CASE WHEN ? = 'canceled' THEN ? ELSE canceled_at END,
             retry_count = COALESCE(?, retry_count),
             current_period_end = COALESCE(?, current_period_end)
           WHERE id = ? AND status = ?`,
        )
        .run(
          transition.to,
          at,
          transition.to,
          at,
          fields.retryCount ?? null,
          fields.currentPeriodEnd ?? null,
          id,
          transition.from,
        );
      if (result.changes !== 1) {
        throw new StaleStateError(`${id} is no longer ${transition.from}; refusing ${transition.trigger}`);
      }
      this.audit(id, transition.from, transition.to, transition.trigger, ctx);
    });
  }

  updateBillingFields(id: string, fields: BillingFields, at: Date): void {
    this.db
      .prepare(
        `UPDATE subscriptions SET
           retry_count = COALESCE(?, retry_count),
           current_period_end = COALESCE(?, current_period_end),
           updated_at = ?
         WHERE id = ?`,
      )
      .run(fields.retryCount ?? null, fields.currentPeriodEnd ?? null, at.toISOString(), id);
  }

  private audit(id: string, from: Status | null, to: Status, trigger: string, ctx: ChangeContext): void {
    this.db
      .prepare(
        `INSERT INTO subscription_audit_log (subscription_id, from_status, to_status, trigger, source, reference, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, from, to, trigger, ctx.source, ctx.reference, ctx.at.toISOString());
  }
}

function toRecord(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    customerId: row.customer_id,
    plan: row.plan,
    paymentMethodId: row.payment_method_id,
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    currentPeriodEnd: row.current_period_end,
    retryCount: row.retry_count,
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
