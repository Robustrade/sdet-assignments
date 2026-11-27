/**
 * Subscription audit log repository backed by SQLite (sql.js).
 * Author: Vedant Dalkari
 */

import type { SqlValue } from 'sql.js';
import { NotFoundError } from '../domain/errors.js';
import type {
  SubscriptionAuditRecord,
  SubscriptionStatus,
  TransitionActor,
} from '../domain/types.js';
import type { SqliteDatabase } from './SqliteDatabase.js';

export interface AppendAuditInput {
  readonly id: string;
  readonly subscription_id: string;
  readonly from_status: SubscriptionStatus | null;
  readonly to_status: SubscriptionStatus;
  readonly trigger: string;
  readonly actor: TransitionActor;
  readonly metadata_json: string;
  readonly created_at: string;
}

const AUDIT_COLUMNS =
  'id, subscription_id, from_status, to_status, trigger, actor, metadata_json, created_at';

export class AuditLogRepo {
  public constructor(private readonly db: SqliteDatabase) {}

  public append(input: AppendAuditInput): SubscriptionAuditRecord {
    this.db.run(
      `INSERT INTO subscription_audit_log (${AUDIT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.subscription_id,
        input.from_status,
        input.to_status,
        input.trigger,
        input.actor,
        input.metadata_json,
        input.created_at,
      ],
    );
    const created = this.db.queryOne<Record<string, SqlValue>>(
      `SELECT ${AUDIT_COLUMNS} FROM subscription_audit_log WHERE id = ?`,
      [input.id],
    );
    if (!created) {
      throw new NotFoundError(`AuditLog "${input.id}" not found after insert`);
    }
    return created as unknown as SubscriptionAuditRecord;
  }

  public findBySubscriptionId(subscriptionId: string): SubscriptionAuditRecord[] {
    const rows = this.db.queryAll<Record<string, SqlValue>>(
      `SELECT ${AUDIT_COLUMNS} FROM subscription_audit_log WHERE subscription_id = ? ORDER BY rowid ASC`,
      [subscriptionId],
    );
    return rows as unknown as SubscriptionAuditRecord[];
  }
}
