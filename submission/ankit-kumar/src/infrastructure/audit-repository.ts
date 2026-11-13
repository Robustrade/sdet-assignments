import type { SubscriptionStatus } from "../domain/subscription-state-machine";
import { TestDatabase } from "./database";

export interface AuditEvent {
  id: string;
  subscriptionId: string;
  eventType: string;
  previousStatus: SubscriptionStatus | null;
  newStatus: SubscriptionStatus | null;
  occurredAt: string;
}

interface AuditEventRow {
  id: string;
  subscription_id: string;
  event_type: string;
  previous_status: string | null;
  new_status: string | null;
  occurred_at: string;
}

function mapAuditEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    eventType: row.event_type,
    previousStatus: row.previous_status as SubscriptionStatus | null,
    newStatus: row.new_status as SubscriptionStatus | null,
    occurredAt: row.occurred_at
  };
}

export class AuditRepository {
  constructor(private readonly database: TestDatabase) {}

  save(event: AuditEvent): void {
    this.database.run(
      `INSERT INTO audit_events
       (id, subscription_id, event_type, previous_status,
        new_status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.subscriptionId,
        event.eventType,
        event.previousStatus,
        event.newStatus,
        event.occurredAt
      ]
    );
  }

  findBySubscription(subscriptionId: string): AuditEvent[] {
    const statement = this.database.connection.prepare(
      `SELECT * FROM audit_events
       WHERE subscription_id = ? ORDER BY occurred_at`,
      [subscriptionId]
    );

    const events: AuditEvent[] = [];

    try {
      while (statement.step()) {
        events.push(
          mapAuditEvent(statement.getAsObject() as unknown as AuditEventRow)
        );
      }
    } finally {
      statement.free();
    }

    return events;
  }
}