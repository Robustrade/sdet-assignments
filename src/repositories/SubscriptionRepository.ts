import Database from "better-sqlite3";

export interface SubscriptionRecord {
  id: string;
  customerId: string;
  plan: string;
  status: string;
  createdAt: string;
}

export class SubscriptionRepository {

  constructor(
    private db: Database.Database
  ) {}

  create(subscription: SubscriptionRecord): void {

    const statement = this.db.prepare(`
      INSERT INTO subscriptions
      (
        id,
        customer_id,
        plan,
        status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `);

    statement.run(
      subscription.id,
      subscription.customerId,
      subscription.plan,
      subscription.status,
      subscription.createdAt
    );
  }


  findById(
    id: string
  ): SubscriptionRecord | undefined {

    const row = this.db.prepare(`
      SELECT
        id,
        customer_id as customerId,
        plan,
        status,
        created_at as createdAt
      FROM subscriptions
      WHERE id = ?
    `).get(id);

    return row as SubscriptionRecord | undefined;
  }


  updateStatus(
    id: string,
    status: string
  ): void {

    this.db.prepare(`
      UPDATE subscriptions
      SET status = ?
      WHERE id = ?
    `)
    .run(status, id);
  }
}