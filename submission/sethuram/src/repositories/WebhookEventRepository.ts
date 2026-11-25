import { WebhookAuditRecord } from "../domain/WebhookEvent";

export interface WebhookEventRepository {
  exists(eventId: string): Promise<boolean>;

  markProcessed(eventId: string): Promise<void>;

  count(): Promise<number>;

  saveAudit(record: WebhookAuditRecord): Promise<void>;

  findAuditHistory(): Promise<WebhookAuditRecord[]>;
}