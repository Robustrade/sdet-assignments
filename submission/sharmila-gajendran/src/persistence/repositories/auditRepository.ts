import type { AuditEntry, AuditKind, ChangeSource, SubscriptionStatus } from '../../domain/types';
import type { Db } from '../database';

interface AuditRow {
  id: number;
  subscription_id: string;
  kind: string;
  from_status: string | null;
  to_status: string;
  trigger_name: string;
  source: string;
  reference: string | null;
  created_at: string;
}

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: Number(row.id),
    subscriptionId: row.subscription_id,
    kind: row.kind as AuditKind,
    fromStatus: row.from_status as SubscriptionStatus | null,
    toStatus: row.to_status as SubscriptionStatus,
    trigger: row.trigger_name,
    source: row.source as ChangeSource,
    reference: row.reference,
    createdAt: row.created_at,
  };
}

export type NewAuditEntry = Omit<AuditEntry, 'id'>;

/** Append-only history of every subscription. */
export class AuditRepository {
  constructor(protected readonly db: Db) {}

  record(entry: NewAuditEntry): void {
    this.db
      .prepare(
        `INSERT INTO subscription_events
           (subscription_id, kind, from_status, to_status, trigger_name, source, reference, created_at)
         VALUES
           (@subscriptionId, @kind, @fromStatus, @toStatus, @trigger, @source, @reference, @createdAt)`,
      )
      .run({
        subscriptionId: entry.subscriptionId,
        kind: entry.kind,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        trigger: entry.trigger,
        source: entry.source,
        reference: entry.reference,
        createdAt: entry.createdAt,
      });
  }

  /** Oldest first. */
  findBySubscription(subscriptionId: string): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM subscription_events WHERE subscription_id = @subscriptionId ORDER BY id')
      .all({ subscriptionId }) as AuditRow[];
    return rows.map(toEntry);
  }

  findAll(): AuditEntry[] {
    const rows = this.db.prepare('SELECT * FROM subscription_events ORDER BY id').all() as AuditRow[];
    return rows.map(toEntry);
  }
}
