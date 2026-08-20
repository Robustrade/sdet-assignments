import { Subscription, Invoice, WebhookEventRecord } from '../domain/types';

/**
 * In-memory, queryable persistence. Kept behind typed methods (Repository
 * pattern) so assertion code and business logic never touch raw storage
 * directly - only through these methods.
 */
export class SubscriptionRepository {
  private store = new Map<string, Subscription>();

  save(sub: Subscription): void {
    this.store.set(sub.id, { ...sub });
  }

  findById(id: string): Subscription | undefined {
    const found = this.store.get(id);
    return found ? { ...found } : undefined;
  }

  all(): Subscription[] {
    return [...this.store.values()];
  }

  clear(): void {
    this.store.clear();
  }
}

export class InvoiceRepository {
  private store: Invoice[] = [];

  save(invoice: Invoice): void {
    this.store.push({ ...invoice });
  }

  findBySubscription(subscriptionId: string): Invoice[] {
    return this.store.filter((i) => i.subscriptionId === subscriptionId).map((i) => ({ ...i }));
  }

  findByInvoiceRef(subscriptionId: string, invoiceRef: string): Invoice[] {
    return this.store
      .filter((i) => i.subscriptionId === subscriptionId && i.invoiceRef === invoiceRef)
      .map((i) => ({ ...i }));
  }

  all(): Invoice[] {
    return [...this.store];
  }

  clear(): void {
    this.store.length = 0;
  }
}

export class WebhookEventRepository {
  private processed = new Map<string, WebhookEventRecord>();

  hasProcessed(eventId: string): boolean {
    return this.processed.has(eventId);
  }

  record(event: WebhookEventRecord): void {
    this.processed.set(event.eventId, { ...event });
  }

  all(): WebhookEventRecord[] {
    return [...this.processed.values()];
  }

  clear(): void {
    this.processed.clear();
  }
}
