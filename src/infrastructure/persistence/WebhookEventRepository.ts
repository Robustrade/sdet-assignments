import { WebhookEvent } from '../../domain/subscription/types';

export interface WebhookEventRepository {
  save(event: WebhookEvent): Promise<void>;
  findByEventId(eventId: string): Promise<WebhookEvent[]>;
}
