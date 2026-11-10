/**
 * In-Memory Webhook Event Repository
 */

import { WebhookEvent } from '../../domain/subscription/types';
import { InMemoryDatabase } from './InMemoryDatabase';
import { WebhookEventRepository } from './WebhookEventRepository';

export class InMemoryWebhookEventRepository implements WebhookEventRepository {
  constructor(private db: InMemoryDatabase) {}

  async save(event: WebhookEvent): Promise<void> {
    this.db.webhookEvents.push({ ...event });
  }

  async findByEventId(eventId: string): Promise<WebhookEvent[]> {
    return this.db.webhookEvents.filter((e) => e.event_id === eventId);
  }

  isProcessed(eventId: string): boolean {
    return this.db.webhookEvents.some((e) => e.event_id === eventId);
  }
}
