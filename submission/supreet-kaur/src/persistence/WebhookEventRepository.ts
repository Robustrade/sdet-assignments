import { InMemoryDatabase } from "./InMemoryDatabase";
import { WebhookEventRecord } from "../domain/WebhookEventRecord";

export class WebhookEventRepository {
  constructor(private readonly db: InMemoryDatabase) {}

  /** True if this event_id has already been recorded as successfully applied or ignored (i.e. genuinely processed, not just rejected at the door). */
  hasBeenProcessed(eventId: string): boolean {
    return this.db.webhookEventsByEventId.has(eventId);
  }

  markProcessed(record: WebhookEventRecord): void {
    if (record.eventId) {
      this.db.webhookEventsByEventId.set(record.eventId, record);
    }
  }

  /** Every delivery attempt, including duplicates and rejected ones -- this is the full audit trail. */
  recordDelivery(record: WebhookEventRecord): void {
    this.db.webhookDeliveries.push(record);
  }

  deliveriesForSubscription(subscriptionId: string): WebhookEventRecord[] {
    return this.db.webhookDeliveries.filter((r) => r.subscriptionId === subscriptionId);
  }

  allDeliveries(): WebhookEventRecord[] {
    return [...this.db.webhookDeliveries];
  }
}
