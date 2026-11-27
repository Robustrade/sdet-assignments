
export interface WebhookEventRecord {
  id: string;
  eventType: string;
  subscriptionId: string;
  processedAt: Date;
}

export class WebhookEventRepository {
  private events = new Map<string, WebhookEventRecord>();

  save(event: WebhookEventRecord): WebhookEventRecord {
    this.events.set(event.id, event);
    return event;
  }

  findById(id: string): WebhookEventRecord | undefined {
    return this.events.get(id);
  }

  exists(id: string): boolean {
    return this.events.has(id);
  }

  findAll(): WebhookEventRecord[] {
    return Array.from(this.events.values());
  }
}
