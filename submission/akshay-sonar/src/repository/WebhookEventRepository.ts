import { WebhookEvent } from "../domain/WebhookEvent";

export class WebhookEventRepository {
  private readonly records = new Map<string, WebhookEvent>();

  save(event: WebhookEvent): WebhookEvent {
    this.records.set(event.eventId, event);
    return event;
  }

  findByEventId(eventId: string): WebhookEvent | undefined {
    return this.records.get(eventId);
  }

  findAll(): WebhookEvent[] {
    return Array.from(this.records.values());
  }

  clear(): void {
    this.records.clear();
  }
}