import type { WebhookEventRecord } from '../domain/WebhookEvent';
import type { WebhookEventRepository } from './WebhookEventRepository';

export class InMemoryWebhookEventRepository implements WebhookEventRepository {
  private readonly rows = new Map<string, WebhookEventRecord>();

  async save(event: WebhookEventRecord): Promise<void> {
    this.rows.set(event.eventId, { ...event });
  }

  async findByEventId(eventId: string): Promise<WebhookEventRecord | undefined> {
    const row = this.rows.get(eventId);
    return row ? { ...row } : undefined;
  }

  async list(): Promise<WebhookEventRecord[]> {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }
}
