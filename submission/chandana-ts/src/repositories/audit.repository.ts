
import db from '../database/connection';
import type Database from 'better-sqlite3';

export class AuditRepository {
  constructor(private database: Database.Database = db) {}

  logStatusChange(
    subscriptionId: string,
    oldStatus: string | null,
    newStatus: string,
    reason: string
  ): void {
    this.database.prepare(`
      INSERT INTO audit_logs (
        subscription_id,
        old_status,
        new_status,
        reason,
        created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      subscriptionId,
      oldStatus,
      newStatus,
      reason,
      new Date().toISOString()
    );
  }

  findBySubscriptionId(subscriptionId: string): unknown[] {
    return this.database.prepare(`
      SELECT *
      FROM audit_logs
      WHERE subscription_id = ?
      ORDER BY created_at ASC
    `).all(subscriptionId);
  }
}
