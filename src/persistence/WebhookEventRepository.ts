import type { Db } from './db.js';
import type { WebhookEventRecord, WebhookEventType } from '../domain/types.js';

interface WebhookEventRow {
  event_id: string;
  subscription_id: string;
  type: string;
  outcome: string;
  processed_at: string;
}

export class WebhookEventRepository {
  constructor(private readonly db: Db) {}

  hasProcessed(eventId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM webhook_events WHERE event_id = ?')
      .get(eventId);
    return row !== undefined;
  }

  recordProcessed(record: WebhookEventRecord): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO webhook_events (event_id, subscription_id, type, outcome, processed_at)
         VALUES (@event_id, @subscription_id, @type, @outcome, @processed_at)`,
      )
      .run({
        event_id: record.eventId,
        subscription_id: record.subscriptionId,
        type: record.type,
        outcome: record.outcome,
        processed_at: record.processedAt,
      });
  }

  findByEventId(eventId: string): WebhookEventRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM webhook_events WHERE event_id = ?')
      .get(eventId) as WebhookEventRow | undefined;
    if (!row) return undefined;
    return {
      eventId: row.event_id,
      subscriptionId: row.subscription_id,
      type: row.type as WebhookEventType,
      outcome: row.outcome,
      processedAt: row.processed_at,
    };
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) as n FROM webhook_events').get() as {
      n: number;
    };
    return row.n;
  }
}