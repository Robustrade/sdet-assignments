
import { AppDatabase } from '../database/database';

export type WebhookStatus = 'received' | 'processed' | 'failed';

export interface WebhookEvent {
  id: string;
  providerEventId: string;
  eventType: string;
  payload: unknown;
  status?: WebhookStatus;
  createdAt?: string;
  processedAt?: string;
}

export class WebhookRepository {
  constructor(private db: AppDatabase) {}

  create(event: WebhookEvent): void {
    this.db.run(
      `INSERT INTO webhook_events
       (id, provider_event_id, event_type, payload, status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        event.id,
        event.providerEventId,
        event.eventType,
        JSON.stringify(event.payload),
        event.status ?? 'received'
      ]
    );
  }

  findByProviderEventId(
    providerEventId: string
  ): WebhookEvent | undefined {
    const statement = this.db.prepare(
      `SELECT * FROM webhook_events WHERE provider_event_id = ?`
    );

    try {
      statement.bind([providerEventId]);

      if (!statement.step()) {
        return undefined;
      }

      const row = statement.getAsObject() as Record<string, unknown>;

      return {
        id: row.id as string,
        providerEventId: row.provider_event_id as string,
        eventType: row.event_type as string,
        payload: JSON.parse(row.payload as string),
        status: row.status as WebhookStatus,
        createdAt: row.created_at as string,
        processedAt: row.processed_at as string | undefined
      };
    } finally {
      statement.free();
    }
  }

  updateStatus(
    providerEventId: string,
    status: WebhookStatus
  ): void {
    this.db.run(
      `UPDATE webhook_events
       SET status = ?,
           processed_at = CASE
             WHEN ? = 'processed' THEN CURRENT_TIMESTAMP
             ELSE processed_at
           END
       WHERE provider_event_id = ?`,
      [status, status, providerEventId]
    );

    if (this.db.getRowsModified() === 0) {
      throw new Error(`Webhook event not found: ${providerEventId}`);
    }
  }
}
