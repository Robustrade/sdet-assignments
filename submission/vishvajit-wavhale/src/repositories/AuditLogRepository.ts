
import type BetterSqlite3 from 'better-sqlite3';

export interface AuditLog {
  id: number;
  subscription_id: string;
  event_type: string;
  previous_state: string | null;
  new_state: string | null;
  source: string;
  metadata_json: string | null;
  created_at: string;
}

export interface CreateAuditLogInput {
  subscription_id: string;
  event_type: string;
  previous_state?: string | null;
  new_state?: string | null;
  source: string;
  metadata?: Record<string, unknown> | null;
}

export class AuditLogRepository {
  constructor(
    private readonly db: BetterSqlite3.Database
  ) {}

  create(input: CreateAuditLogInput): AuditLog {
    const metadataJson = input.metadata
      ? JSON.stringify(input.metadata)
      : null;

    const result = this.db.prepare(`
      INSERT INTO audit_logs (
        subscription_id,
        event_type,
        previous_state,
        new_state,
        source,
        metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.subscription_id,
      input.event_type,
      input.previous_state ?? null,
      input.new_state ?? null,
      input.source,
      metadataJson
    );

    const log = this.findById(Number(result.lastInsertRowid));

    if (!log) {
      throw new Error('Audit log creation failed');
    }

    return log;
  }

  findById(id: number): AuditLog | null {
    const log = this.db.prepare(`
      SELECT *
      FROM audit_logs
      WHERE id = ?
    `).get(id) as AuditLog | undefined;

    return log ?? null;
  }

  findBySubscriptionId(
    subscriptionId: string
  ): AuditLog[] {
    return this.db.prepare(`
      SELECT *
      FROM audit_logs
      WHERE subscription_id = ?
      ORDER BY id ASC
    `).all(subscriptionId) as AuditLog[];
  }

  findAll(): AuditLog[] {
    return this.db.prepare(`
      SELECT *
      FROM audit_logs
      ORDER BY id ASC
    `).all() as AuditLog[];
  }
}
