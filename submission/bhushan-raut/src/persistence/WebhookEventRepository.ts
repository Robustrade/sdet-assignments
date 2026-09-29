import { one, type Db } from './database';

export type WebhookOutcome =
  | 'applied'
  | 'ignored_stale'
  | 'ignored_invalid_transition'
  | 'ignored_unknown_reference'
  | 'ignored_amount_mismatch';

export class WebhookEventRepository {
  constructor(private readonly db: Db) {}

  findOutcome(eventId: string): WebhookOutcome | undefined {
    return one<{ outcome: WebhookOutcome }>(this.db, 'SELECT outcome FROM webhook_events WHERE event_id = ?', eventId)
      ?.outcome;
  }

  recordRedelivery(eventId: string, at: Date): void {
    this.db
      .prepare('UPDATE webhook_events SET delivery_count = delivery_count + 1, last_received_at = ? WHERE event_id = ?')
      .run(at.toISOString(), eventId);
  }

  /** event_id is the primary key: a second insert for the same event fails at the database. */
  insert(
    event: { eventId: string; type: string; subscriptionId: string; invoiceId: string; payload: string },
    outcome: WebhookOutcome,
    at: Date,
  ): void {
    const ts = at.toISOString();
    this.db
      .prepare(
        `INSERT INTO webhook_events (event_id, type, subscription_id, invoice_id, payload, outcome, first_received_at, last_received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(event.eventId, event.type, event.subscriptionId, event.invoiceId, event.payload, outcome, ts, ts);
  }
}
