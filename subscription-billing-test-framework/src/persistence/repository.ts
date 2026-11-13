export interface SubscriptionRecord {
  id: string;
  customerId: string;
  plan: string;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  paymentMethodId: string;
  createdAt: Date;
}

export interface InvoiceRecord {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: 'paid' | 'failed' | 'refunded';
  createdAt: Date;
}

export class InMemoryRepository {
  private subscriptions = new Map<string, SubscriptionRecord>();
  private invoices = new Map<string, InvoiceRecord>();
  private processedEvents = new Set<string>();

  public saveSubscription(sub: SubscriptionRecord): void {
    this.subscriptions.set(sub.id, { ...sub });
  }

  public getSubscription(id: string): SubscriptionRecord | undefined {
    const sub = this.subscriptions.get(id);
    return sub ? { ...sub } : undefined;
  }

  public saveInvoice(invoice: InvoiceRecord): void {
    this.invoices.set(invoice.id, { ...invoice });
  }

  public getInvoicesForSubscription(subscriptionId: string): InvoiceRecord[] {
    return Array.from(this.invoices.values()).filter(inv => inv.subscriptionId === subscriptionId);
  }

  public hasProcessedEvent(eventId: string): boolean {
    return this.processedEvents.has(eventId);
  }

  public markEventProcessed(eventId: string): void {
    this.processedEvents.add(eventId);
  }

  public clear(): void {
    this.subscriptions.clear();
    this.invoices.clear();
    this.processedEvents.clear();
  }
}