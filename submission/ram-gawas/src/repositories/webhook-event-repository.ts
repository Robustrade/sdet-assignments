import Database from 'better-sqlite3';

export interface WebhookEventRecord {
  eventId: string;
  subscriptionId: string;
  eventType: string;
  processed: boolean;
}

export interface StoredWebhookEvent extends WebhookEventRecord {
  deliveryCount: number;
  createdAt: string;
  lastReceivedAt: string;
}

export class WebhookEventRepository {
  constructor(private db: Database.Database) {}

  exists(eventId: string): boolean {
    const row = this.db.prepare(`
      SELECT event_id
      FROM webhook_events
      WHERE event_id = ?
    `).get(eventId);

    return !!row;
  }

  save(event: WebhookEventRecord): void {
    const receivedAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO webhook_events (
        event_id,
        subscription_id,
        event_type,
        processed,
        last_received_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.subscriptionId,
      event.eventType,
      event.processed ? 1 : 0,
      receivedAt,
      receivedAt,
    );
  }

  incrementDelivery(eventId: string): void {
    this.db.prepare(`
      UPDATE webhook_events
      SET delivery_count = delivery_count + 1, last_received_at = ?
      WHERE event_id = ?
    `).run(new Date().toISOString(), eventId);
  }

  findById(eventId: string): StoredWebhookEvent | undefined {
    const row = this.db.prepare(`
      SELECT event_id AS eventId, subscription_id AS subscriptionId,
        event_type AS eventType, processed, delivery_count AS deliveryCount,
        created_at AS createdAt, last_received_at AS lastReceivedAt
      FROM webhook_events WHERE event_id = ?
    `).get(eventId) as (Omit<StoredWebhookEvent, 'processed'> & { processed: number }) | undefined;

    return row ? { ...row, processed: row.processed === 1 } : undefined;
  }
}
