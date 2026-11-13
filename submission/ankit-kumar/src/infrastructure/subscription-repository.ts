import type { SubscriptionStatus } from "../domain/subscription-state-machine";
import { TestDatabase } from "./database";

export interface Subscription {
  id: string;
  customerId: string;
  plan: string;
  paymentMethodId: string;
  status: SubscriptionStatus;
  trialEndsAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan: string;
  payment_method_id: string;
  trial_ends_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export class SubscriptionRepository {
  constructor(private readonly database: TestDatabase) {}

  save(subscription: Subscription): void {
    this.database.run(
      `INSERT INTO subscriptions
       (id, customer_id, plan, payment_method_id, trial_ends_at,
        status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        subscription.id,
        subscription.customerId,
        subscription.plan,
        subscription.paymentMethodId,
        subscription.trialEndsAt ?? null,
        subscription.status,
        subscription.createdAt,
        subscription.updatedAt
      ]
    );
  }

  findById(id: string): Subscription | undefined {
    const row = this.database.get<SubscriptionRow>(
      "SELECT * FROM subscriptions WHERE id = ?",
      [id]
    );

    if (!row) return undefined;

    return {
      id: row.id,
      customerId: row.customer_id,
      plan: row.plan,
      paymentMethodId: row.payment_method_id,
      status: row.status as SubscriptionStatus,
      ...(row.trial_ends_at
        ? { trialEndsAt: row.trial_ends_at }
        : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  updateStatus(
    id: string,
    status: SubscriptionStatus,
    updatedAt: string
  ): void {
    this.database.run(
      "UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ?",
      [status, updatedAt, id]
    );
  }
}