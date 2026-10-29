import type { WebhookEventRecord } from '../domain/WebhookEvent';

export interface WebhookEventRepository {
  /** Insert or replace by event id. */
  save(event: WebhookEventRecord): Promise<void>;
  findByEventId(eventId: string): Promise<WebhookEventRecord | undefined>;
  list(): Promise<WebhookEventRecord[]>;
}
