import { WebhookEventRepository }
from "./WebhookEventRepository";

export class InMemoryWebhookEventRepository
  implements WebhookEventRepository {

  private events =
    new Set<string>();

  save(
    eventId: string
  ): void {

    this.events.add(eventId);

  }

  exists(
    eventId: string
  ): boolean {

    return this.events.has(
      eventId
    );

  }
}