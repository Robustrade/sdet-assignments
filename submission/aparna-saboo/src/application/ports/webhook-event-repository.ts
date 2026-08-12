import type { WebhookEvent } from '../../domain/models/webhook-event';

export interface WebhookEventRepository {
  findByEventId(eventId: string): WebhookEvent | undefined;
  save(event: WebhookEvent): void;
  delete(eventId: string): void;
}
