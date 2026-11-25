import { WebhookEventRepository } from "./WebhookEventRepository";
import { WebhookAuditRecord } from "../domain/WebhookEvent";

export class InMemoryWebhookEventRepository
  implements WebhookEventRepository {

  private readonly processedEvents = new Set<string>();

  private readonly auditHistory: WebhookAuditRecord[] = [];

  async exists(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async markProcessed(eventId: string): Promise<void> {
    this.processedEvents.add(eventId);
  }

  async count(): Promise<number> {
    return this.processedEvents.size;
  }

  async saveAudit(
    record: WebhookAuditRecord
  ): Promise<void> {
    this.auditHistory.push({
      ...record,
      processedAt: new Date(record.processedAt)
    });
  }

  async findAuditHistory(): Promise<WebhookAuditRecord[]> {
    return this.auditHistory.map(record => ({
      ...record,
      processedAt: new Date(record.processedAt)
    }));
  }
}