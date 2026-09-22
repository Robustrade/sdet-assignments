import Database from 'better-sqlite3';

export interface WebhookEventRecord {
  eventId: string;
  subscriptionId: string;
  eventType: string;
  processed: boolean;
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
    this.db.prepare(`
      INSERT INTO webhook_events (
        event_id,
        subscription_id,
        event_type,
        processed,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.subscriptionId,
      event.eventType,
      event.processed ? 1 : 0,
      new Date().toISOString(),
    );
  }
}