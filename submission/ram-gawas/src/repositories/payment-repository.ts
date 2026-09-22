import Database from 'better-sqlite3';

export interface PaymentRecord {
  id: string;
  subscriptionId: string;
  amount: number;
  status: 'success' | 'failed' | 'refunded';
  providerReference?: string;
}

export class PaymentRepository {
  constructor(private db: Database.Database) {}

  save(payment: PaymentRecord): void {
    this.db.prepare(`
      INSERT INTO payments (
        id,
        subscription_id,
        amount,
        status,
        provider_reference,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      payment.id,
      payment.subscriptionId,
      payment.amount,
      payment.status,
      payment.providerReference ?? null,
      new Date().toISOString(),
    );
  }

  findById(id: string): PaymentRecord | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM payments
      WHERE id = ?
    `).get(id) as any;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      subscriptionId: row.subscription_id,
      amount: row.amount,
      status: row.status,
      providerReference: row.provider_reference ?? undefined,
    };
  }

  findBySubscriptionId(subscriptionId: string): PaymentRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM payments
      WHERE subscription_id = ?
    `).all(subscriptionId) as any[];

    return rows.map((row) => ({
      id: row.id,
      subscriptionId: row.subscription_id,
      amount: row.amount,
      status: row.status,
      providerReference: row.provider_reference ?? undefined,
    }));
  }
}
