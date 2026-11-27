/**
 * Webhook event idempotency repository backed by SQLite (sql.js).
 * Author: Vedant Dalkari
 */

import type { SqlValue } from 'sql.js';
import { NotFoundError } from '../domain/errors.js';
import type { WebhookEventRecord, WebhookEventType, WebhookOutcome } from '../domain/types.js';
import type { SqliteDatabase } from './SqliteDatabase.js';

export interface RecordWebhookEventInput {
  readonly event_id: string;
  readonly event_type: WebhookEventType;
  readonly subscription_id: string | null;
  readonly invoice_id: string | null;
  readonly outcome: WebhookOutcome;
  readonly payload_hash: string;
  readonly received_at: string;
}

const WEBHOOK_COLUMNS =
  'event_id, event_type, subscription_id, invoice_id, outcome, payload_hash, received_at';

export class WebhookEventRepo {
  public constructor(private readonly db: SqliteDatabase) {}

  public findByEventId(eventId: string): WebhookEventRecord | null {
    const row = this.db.queryOne<Record<string, SqlValue>>(
      `SELECT ${WEBHOOK_COLUMNS} FROM webhook_events WHERE event_id = ?`,
      [eventId],
    );
    return (row as unknown as WebhookEventRecord | null);
  }

  public record(input: RecordWebhookEventInput): WebhookEventRecord {
    this.db.run(
      `INSERT INTO webhook_events (${WEBHOOK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.event_id,
        input.event_type,
        input.subscription_id,
        input.invoice_id,
        input.outcome,
        input.payload_hash,
        input.received_at,
      ],
    );
    const created = this.findByEventId(input.event_id);
    if (!created) {
      throw new NotFoundError(`WebhookEvent "${input.event_id}" not found after insert`);
    }
    return created;
  }
}
