/**
 * Subscription repository enforcing ApprovedTransition-branded state commits.
 * Author: Vedant Dalkari
 */

import type { SqlValue } from 'sql.js';
import { InvalidTransitionError, NotFoundError } from '../domain/errors.js';
import { hasApprovedTransitionMarker } from '../domain/LifecycleEngine.js';
import type { ApprovedTransition, PlanCode, SubscriptionRecord } from '../domain/types.js';
import type { SqliteDatabase } from './SqliteDatabase.js';

export interface CreateSubscriptionRowInput {
  readonly id: string;
  readonly customer_id: string;
  readonly plan: PlanCode;
  readonly payment_method_id: string;
  readonly failed_attempts: number;
  readonly trial_ends_at: string | null;
  readonly current_period_start: string;
  readonly current_period_end: string;
  readonly canceled_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface TransitionCommitUpdates {
  readonly failed_attempts?: number;
  readonly trial_ends_at?: string | null;
  readonly current_period_start?: string;
  readonly current_period_end?: string;
  readonly canceled_at?: string | null;
  readonly updated_at: string;
}

const SUBSCRIPTION_COLUMNS =
  'id, customer_id, plan, status, payment_method_id, failed_attempts, trial_ends_at, current_period_start, current_period_end, canceled_at, created_at, updated_at';

export class SubscriptionRepo {
  public constructor(private readonly db: SqliteDatabase) {}

  public createWithInitialTransition(
    input: CreateSubscriptionRowInput,
    transition: ApprovedTransition,
  ): SubscriptionRecord {
    this.assertBrandedTransition(transition);
    if (transition.fromStatus !== null) {
      throw new InvalidTransitionError(
        transition.fromStatus,
        transition.trigger,
        'Initial subscription creation requires fromStatus = null',
      );
    }

    this.db.run(
      `INSERT INTO subscriptions (${SUBSCRIPTION_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.customer_id,
        input.plan,
        transition.toStatus,
        input.payment_method_id,
        input.failed_attempts,
        input.trial_ends_at,
        input.current_period_start,
        input.current_period_end,
        input.canceled_at,
        input.created_at,
        input.updated_at,
      ],
    );

    return this.requireById(input.id);
  }

  public findById(id: string): SubscriptionRecord | null {
    const row = this.db.queryOne<Record<string, SqlValue>>(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE id = ?`,
      [id],
    );
    return (row as unknown as SubscriptionRecord | null);
  }

  public findDueForBilling(_nowIso: string): SubscriptionRecord[] {
    const rows = this.db.queryAll<Record<string, SqlValue>>(
      `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions WHERE status IN ('trialing', 'active', 'past_due') ORDER BY created_at ASC, rowid ASC`,
    );
    return rows as unknown as SubscriptionRecord[];
  }

  public commitTransition(
    subscriptionId: string,
    transition: ApprovedTransition,
    updates: TransitionCommitUpdates,
  ): SubscriptionRecord {
    this.assertBrandedTransition(transition);

    const current = this.findById(subscriptionId);
    if (!current) {
      throw new NotFoundError(`Subscription "${subscriptionId}" not found`);
    }
    if (current.status !== transition.fromStatus) {
      throw new InvalidTransitionError(
        current.status,
        transition.trigger,
        `Transition expected status "${String(transition.fromStatus)}" but found "${current.status}"`,
      );
    }

    this.db.run(
      `UPDATE subscriptions
       SET status = ?,
           failed_attempts = ?,
           trial_ends_at = ?,
           current_period_start = ?,
           current_period_end = ?,
           canceled_at = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        transition.toStatus,
        updates.failed_attempts ?? current.failed_attempts,
        updates.trial_ends_at !== undefined ? updates.trial_ends_at : current.trial_ends_at,
        updates.current_period_start ?? current.current_period_start,
        updates.current_period_end ?? current.current_period_end,
        updates.canceled_at !== undefined ? updates.canceled_at : current.canceled_at,
        updates.updated_at,
        subscriptionId,
      ],
    );

    return this.requireById(subscriptionId);
  }

  public incrementFailedAttempts(
    subscriptionId: string,
    failedAttempts: number,
    updatedAt: string,
  ): SubscriptionRecord {
    this.db.run(
      'UPDATE subscriptions SET failed_attempts = ?, updated_at = ? WHERE id = ?',
      [failedAttempts, updatedAt, subscriptionId],
    );
    return this.requireById(subscriptionId);
  }

  public updateBillingPeriod(
    subscriptionId: string,
    periodStart: string,
    periodEnd: string,
    updatedAt: string,
  ): SubscriptionRecord {
    this.db.run(
      'UPDATE subscriptions SET current_period_start = ?, current_period_end = ?, updated_at = ? WHERE id = ?',
      [periodStart, periodEnd, updatedAt, subscriptionId],
    );
    return this.requireById(subscriptionId);
  }

  private assertBrandedTransition(transition: unknown): asserts transition is ApprovedTransition {
    if (!hasApprovedTransitionMarker(transition)) {
      throw new InvalidTransitionError(
        null,
        'unbranded_mutation',
        'Subscription status mutation rejected: unbranded ApprovedTransition token',
      );
    }
  }

  private requireById(id: string): SubscriptionRecord {
    const found = this.findById(id);
    if (!found) {
      throw new NotFoundError(`Subscription "${id}" not found`);
    }
    return found;
  }
}
