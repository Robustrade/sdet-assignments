import type { DatabaseSync } from 'node:sqlite';

export interface AuditRecord {
    id?: number;
    subscriptionId: string;
    oldState: string | null;
    newState: string;
    eventType: string;
    correlationId: string;
    createdAt: string;
}

export class AuditRepository {
    constructor(private readonly db: DatabaseSync) { }

    create(record: AuditRecord): void {
        this.db
            .prepare(`
        INSERT INTO audit_log (
          subscription_id,
          old_state,
          new_state,
          event_type,
          correlation_id,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
            .run(
                record.subscriptionId,
                record.oldState,
                record.newState,
                record.eventType,
                record.correlationId,
                record.createdAt,
            );
    }

    getBySubscriptionId(
        subscriptionId: string,
    ): AuditRecord[] {
        const rows = this.db
            .prepare(`
        SELECT
          id,
          subscription_id,
          old_state,
          new_state,
          event_type,
          correlation_id,
          created_at
        FROM audit_log
        WHERE subscription_id = ?
        ORDER BY id ASC
      `)
            .all(subscriptionId) as Array<{
                id: number;
                subscription_id: string;
                old_state: string | null;
                new_state: string;
                event_type: string;
                correlation_id: string;
                created_at: string;
            }>;

        return rows.map((row) => ({
            id: row.id,
            subscriptionId: row.subscription_id,
            oldState: row.old_state,
            newState: row.new_state,
            eventType: row.event_type,
            correlationId: row.correlation_id,
            createdAt: row.created_at,
        }));
    }

    getLatestBySubscriptionId(
        subscriptionId: string,
    ): AuditRecord | undefined {
        const row = this.db
            .prepare(`
        SELECT
          id,
          subscription_id,
          old_state,
          new_state,
          event_type,
          correlation_id,
          created_at
        FROM audit_log
        WHERE subscription_id = ?
        ORDER BY id DESC
        LIMIT 1
      `)
            .get(subscriptionId) as
            | {
                id: number;
                subscription_id: string;
                old_state: string | null;
                new_state: string;
                event_type: string;
                correlation_id: string;
                created_at: string;
            }
            | undefined;

        if (!row) {
            return undefined;
        }

        return {
            id: row.id,
            subscriptionId: row.subscription_id,
            oldState: row.old_state,
            newState: row.new_state,
            eventType: row.event_type,
            correlationId: row.correlation_id,
            createdAt: row.created_at,
        };
    }

    countBySubscriptionId(subscriptionId: string): number {
        const row = this.db
            .prepare(`
        SELECT COUNT(*) AS count
        FROM audit_log
        WHERE subscription_id = ?
      `)
            .get(subscriptionId) as { count: number };

        return row.count;
    }
}