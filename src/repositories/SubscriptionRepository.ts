import { DB } from '../infrastructure/Database';
import { Subscription } from '../domain/Subscription';
import { PlanTier } from '../domain/Plan';

export class SubscriptionRepository {
  constructor(private db: DB) {}

  save(sub: Subscription) {
    this.db.saveSubscription(sub);
  }

  get(id: string): Subscription | null {
    return this.db.getSubscription(id);
  }

  isEventProcessed(eventId: string): boolean {
    return this.db.isEventProcessed(eventId);
  }

  markEventProcessed(eventId: string) {
    this.db.markEventProcessed(eventId);
  }

  saveInvoice(id: string, subId: string, amount: number, status: 'paid' | 'failed' | 'refunded', type: string) {
    this.db.saveInvoice(id, subId, amount, status, type);
  }

  getInvoice(id: string) {
    return this.db.getInvoice(id);
  }

  getInvoices(subId: string) {
    return this.db.getInvoices(subId);
  }

  logEvent(id: string, subId: string, eventType: string, details: string) {
    this.db.logSubscriptionEvent(id, subId, eventType, details);
  }

  getEvents(subId: string) {
    return this.db.getSubscriptionEvents(subId);
  }
}
