export class SubscriptionRepository {
  private subscriptions: Map<string, any>;
  private invoices: Map<string, any>;
  private events: any[];
  private eventIds: Set<string>;

  constructor() {
    this.subscriptions = new Map();
    this.invoices = new Map();
    this.events = [];
    this.eventIds = new Set();
  }

  saveSubscription(subscription: any) {
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  getSubscription(id: string) {
    return this.subscriptions.get(id) || null;
  }

  updateSubscription(id: string, reducer: (current: any) => any) {
    const current = this.subscriptions.get(id);
    if (!current) {
      return null;
    }

    const next = reducer(current);
    this.subscriptions.set(id, next);
    return next;
  }

  saveInvoice(invoice: any) {
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  getInvoice(id: string) {
    return this.invoices.get(id) || null;
  }

  logEvent(subscriptionId: string, event: any) {
    if (event.event_id) {
      this.eventIds.add(event.event_id);
    }

    this.events.push({
      subscription_id: subscriptionId,
      ...event,
      recorded_at: new Date().toISOString(),
    });

    return event;
  }

  hasSeenEvent(eventId: string) {
    return this.eventIds.has(eventId);
  }

  listEvents(subscriptionId: string) {
    return this.events.filter((event) => event.subscription_id === subscriptionId);
  }
}

export default SubscriptionRepository;
