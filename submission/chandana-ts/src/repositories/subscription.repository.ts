
import db from '../database/connection';
import type Database from 'better-sqlite3';
import {
  Subscription,
  CreateSubscriptionInput
} from '../models/subscription';

export class SubscriptionRepository {
  constructor(private database: Database.Database = db) {}

  create(
    input: CreateSubscriptionInput,
    id: string,
    status: Subscription['status']
  ): Subscription {

    const now = new Date().toISOString();

    this.database.prepare(`
      INSERT INTO subscriptions (
        id,
        customer_id,
        plan,
        status,
        created_at,
        updated_at,
        canceled_at
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      input.customer_id,
      input.plan,
      status,
      now,
      now
    );

    return this.findById(id)!;
  }

  findById(id: string): Subscription | undefined {

    return this.database.prepare(`
      SELECT * FROM subscriptions WHERE id = ?
    `).get(id) as Subscription | undefined;
  }

  updateStatus(
    id: string,
    status: Subscription['status']
  ): void {

    const now = new Date().toISOString();

    this.database.prepare(`
      UPDATE subscriptions
      SET status = ?,
          updated_at = ?,
          canceled_at = CASE
            WHEN ? = 'canceled' THEN ?
            ELSE canceled_at
          END
      WHERE id = ?
    `).run(status, now, status, now, id);
  }
}
