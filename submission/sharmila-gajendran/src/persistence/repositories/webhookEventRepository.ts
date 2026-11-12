import type { StoredWebhookOutcome, WebhookEventRecord } from '../../domain/types';
import type { Db } from '../database';

interface WebhookEventRow {
  event_id: string;
  type: string;
  subscription_id: string;
  invoice_id: string;
  outcome: string;
  received_at: string;
}

function toRecord(row: WebhookEventRow): WebhookEventRecord {
  return {
    eventId: row.event_id,
    type: row.type,
    subscriptionId: row.subscription_id,
    invoiceId: row.invoice_id,
    outcome: row.outcome as StoredWebhookOutcome,
    receivedAt: row.received_at,
  };
}

/** Processed event ids. The primary key on event_id is what makes webhook handling idempotent. */
export class WebhookEventRepository {
  constructor(private readonly db: Db) {}

  exists(eventId: string): boolean {
    return this.db.prepare('SELECT 1 AS found FROM webhook_events WHERE event_id = @eventId').get({ eventId }) !== undefined;
  }

  insert(record: WebhookEventRecord): void {
    this.db
      .prepare(
        `INSERT INTO webhook_events (event_id, type, subscription_id, invoice_id, outcome, received_at)
         VALUES (@eventId, @type, @subscriptionId, @invoiceId, @outcome, @receivedAt)`,
      )
      .run({
        eventId: record.eventId,
        type: record.type,
        subscriptionId: record.subscriptionId,
        invoiceId: record.invoiceId,
        outcome: record.outcome,
        receivedAt: record.receivedAt,
      });
  }

  findById(eventId: string): WebhookEventRecord | undefined {
    const row = this.db.prepare('SELECT * FROM webhook_events WHERE event_id = @eventId').get({ eventId }) as
      | WebhookEventRow
      | undefined;
    return row ? toRecord(row) : undefined;
  }

  findAll(): WebhookEventRecord[] {
    const rows = this.db.prepare('SELECT * FROM webhook_events ORDER BY rowid').all() as WebhookEventRow[];
    return rows.map(toRecord);
  }
}
