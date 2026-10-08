import { PaymentWebhookType, WebhookEventRecord } from '../domain/models/webhook-event.model';

export class WebhookEventRepository {
  private readonly records = new Map<string, WebhookEventRecord>();

  findById(eventId: string): WebhookEventRecord | undefined {
    const record = this.records.get(eventId);
    return record ? { ...record } : undefined;
  }

  record(eventId: string, subscriptionId: string, type: PaymentWebhookType, outcome: 'applied' | 'ignored'): void {
    this.records.set(eventId, {
      eventId,
      subscriptionId,
      type,
      receivedAt: new Date().toISOString(),
      deliveryCount: 1,
      outcome,
    });
  }

  recordDuplicate(eventId: string): void {
    const record = this.records.get(eventId);
    if (!record) {
      throw new Error(`Cannot record delivery for unknown webhook event "${eventId}"`);
    }
    record.deliveryCount += 1;
  }

  all(): WebhookEventRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }
}
