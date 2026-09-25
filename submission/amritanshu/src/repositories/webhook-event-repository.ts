import type { WebhookEvent } from "../domain/webhook-event.js";

export interface WebhookEventRepository {
  save(event: WebhookEvent): void;
  findByEventId(eventId: string): WebhookEvent | undefined;
}