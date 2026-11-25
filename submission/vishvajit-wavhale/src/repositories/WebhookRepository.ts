
import type BetterSqlite3 from 'better-sqlite3';

export type WebhookProcessingStatus =
  | 'received'
  | 'processed'
  | 'ignored'
  | 'failed';

export interface WebhookEvent {
  event_id: string;
  event_type: string;
  subscription_id: string | null;
  payload_json: string;
  processing_status: WebhookProcessingStatus;
  received_at: string;
  processed_at: string | null;
}

export interface CreateWebhookInput {
  event_id: string;
  event_type: string;
  subscription_id?: string | null;
  payload_json: string;
}

export class WebhookRepository {
  constructor(
    private readonly db: BetterSqlite3.Database
  ) {}

  create(input: CreateWebhookInput): WebhookEvent {
    this.db.prepare(`
      INSERT INTO webhook_events (
        event_id,
        event_type,
        subscription_id,
        payload_json,
        processing_status
      )
      VALUES (?, ?, ?, ?, 'received')
    `).run(
      input.event_id,
      input.event_type,
      input.subscription_id ?? null,
      input.payload_json
    );

    const event = this.findById(input.event_id);

    if (!event) {
      throw new Error('Webhook event creation failed');
    }

    return event;
  }

  findById(eventId: string): WebhookEvent | null {
    const event = this.db.prepare(`
      SELECT *
      FROM webhook_events
      WHERE event_id = ?
    `).get(eventId) as WebhookEvent | undefined;

    return event ?? null;
  }

  exists(eventId: string): boolean {
    const result = this.db.prepare(`
      SELECT 1
      FROM webhook_events
      WHERE event_id = ?
    `).get(eventId);

    return result !== undefined;
  }

  findBySubscriptionId(
    subscriptionId: string
  ): WebhookEvent[] {
    return this.db.prepare(`
      SELECT *
      FROM webhook_events
      WHERE subscription_id = ?
      ORDER BY received_at DESC
    `).all(subscriptionId) as WebhookEvent[];
  }

  findLatestProcessedPaymentEvent(
    subscriptionId: string
  ): WebhookEvent | null {
    const events = this.db.prepare(`
      SELECT *
      FROM webhook_events
      WHERE subscription_id = ?
        AND processing_status = 'processed'
        AND event_type IN (
          'payment.succeeded',
          'payment.failed'
        )
    `).all(subscriptionId) as WebhookEvent[];

    let latestEvent: WebhookEvent | null = null;
    let latestTimestamp = Number.NEGATIVE_INFINITY;

    for (const event of events) {
      try {
        const payload: unknown = JSON.parse(event.payload_json);

        if (
          typeof payload !== 'object' ||
          payload === null ||
          !('created_at' in payload) ||
          typeof payload.created_at !== 'string'
        ) {
          continue;
        }

        const timestamp = Date.parse(payload.created_at);

        if (Number.isNaN(timestamp)) {
          continue;
        }

        if (
          timestamp > latestTimestamp ||
          (
            timestamp === latestTimestamp &&
            latestEvent !== null &&
            event.received_at > latestEvent.received_at
          )
        ) {
          latestTimestamp = timestamp;
          latestEvent = event;
        }
      } catch {
        // Ignore malformed historical payloads.
      }
    }

    return latestEvent;
  }

  updateProcessingStatus(
    eventId: string,
    status: Exclude<WebhookProcessingStatus, 'received'>
  ): WebhookEvent {
    const result = this.db.prepare(`
      UPDATE webhook_events
      SET processing_status = ?,
          processed_at = CURRENT_TIMESTAMP
      WHERE event_id = ?
    `).run(status, eventId);

    if (result.changes === 0) {
      throw new Error(`Webhook event not found: ${eventId}`);
    }

    const event = this.findById(eventId);

    if (!event) {
      throw new Error('Webhook event update failed');
    }

    return event;
  }
}
