import { TestDatabase } from "./database";

export interface WebhookEventData {
  eventId: string;
  type: string;
  subscriptionId: string;
  invoiceId: string;
  amount: number;
  currency: string;
}

export interface WebhookEventRecord extends WebhookEventData {
  deliveryCount: number;
  processed: boolean;
  receivedAt: string;
}

interface WebhookEventRow {
  event_id: string;
  event_type: string;
  subscription_id: string;
  invoice_id: string;
  payload_json: string;
  delivery_count: number;
  processed: number;
  received_at: string;
}

export class WebhookEventRepository {
  constructor(private readonly database: TestDatabase) {}

  recordDelivery(event: WebhookEventData, receivedAt: string): boolean {
    const existing = this.findByEventId(event.eventId);

    if (existing) {
      this.database.run(
        `UPDATE webhook_events
         SET delivery_count = delivery_count + 1
         WHERE event_id = ?`,
        [event.eventId]
      );
      return false;
    }

    this.database.run(
      `INSERT INTO webhook_events
       (event_id, event_type, subscription_id, invoice_id,
        payload_json, delivery_count, processed, received_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?)`,
      [
        event.eventId,
        event.type,
        event.subscriptionId,
        event.invoiceId,
        JSON.stringify(event),
        receivedAt
      ]
    );

    return true;
  }

  markProcessed(eventId: string): void {
    this.database.run(
      "UPDATE webhook_events SET processed = 1 WHERE event_id = ?",
      [eventId]
    );
  }

  findByEventId(eventId: string): WebhookEventRecord | undefined {
    const row = this.database.get<WebhookEventRow>(
      "SELECT * FROM webhook_events WHERE event_id = ?",
      [eventId]
    );

    if (!row) return undefined;

    const payload = JSON.parse(row.payload_json) as WebhookEventData;

    return {
      ...payload,
      deliveryCount: row.delivery_count,
      processed: row.processed === 1,
      receivedAt: row.received_at
    };
  }
}