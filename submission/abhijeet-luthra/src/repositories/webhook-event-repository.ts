import { Db } from '../db/database';
import { WebhookEvent } from '../domain/types';

const COLUMNS = `event_id AS eventId, event_type AS eventType, subscription_id AS subscriptionId,
  invoice_id AS invoiceId, provider_reference AS providerReference, payload,
  processing_status AS processingStatus, ignore_reason AS ignoreReason, matched_payment_id AS matchedPaymentId,
  delivery_count AS deliveryCount, first_received_at AS firstReceivedAt, last_received_at AS lastReceivedAt`;

export class WebhookEventRepository {
  constructor(private readonly db: Db) {}

  insert(e: WebhookEvent): void {
    this.db
      .prepare(
        `INSERT INTO webhook_events (event_id, event_type, subscription_id, invoice_id, provider_reference, payload,
           processing_status, ignore_reason, matched_payment_id, delivery_count, first_received_at, last_received_at)
         VALUES (@eventId, @eventType, @subscriptionId, @invoiceId, @providerReference, @payload,
           @processingStatus, @ignoreReason, @matchedPaymentId, @deliveryCount, @firstReceivedAt, @lastReceivedAt)`,
      )
      .run(e);
  }

  /** A duplicate delivery is recorded (requirement) but changes nothing else. */
  recordDuplicateDelivery(eventId: string, now: string): void {
    this.db
      .prepare('UPDATE webhook_events SET delivery_count = delivery_count + 1, last_received_at = ? WHERE event_id = ?')
      .run(now, eventId);
  }

  findById(eventId: string): WebhookEvent | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM webhook_events WHERE event_id = ?`).get(eventId) as
      | WebhookEvent
      | undefined;
  }

  findBySubscription(subscriptionId: string): WebhookEvent[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM webhook_events WHERE subscription_id = ? ORDER BY first_received_at, event_id`)
      .all(subscriptionId) as WebhookEvent[];
  }
}
