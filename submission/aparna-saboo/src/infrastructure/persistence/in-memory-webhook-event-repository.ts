import type { WebhookEvent } from '../../domain/models/webhook-event';
import type { WebhookEventRepository } from '../../application/ports/webhook-event-repository';

export class InMemoryWebhookEventRepository implements WebhookEventRepository {
  private readonly webhookEvents = new Map<string, WebhookEvent>();

  findByEventId(eventId: string): WebhookEvent | undefined {
    return this.webhookEvents.get(eventId);
  }

  save(event: WebhookEvent): void {
    this.webhookEvents.set(event.eventId, event);
  }

  delete(eventId: string): void {
    this.webhookEvents.delete(eventId);
  }
}
