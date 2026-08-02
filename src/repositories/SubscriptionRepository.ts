import { DB } from '../infrastructure/Database';
import { Subscription } from '../domain/Subscription';
import { PlanTier } from '../domain/Plan';

/**
 * Repository wrapper around the `DB` adapter that provides typed accessors
 * for subscriptions, invoices and events. Keeps persistence logic out of services.
 */
export class SubscriptionRepository {
  constructor(private db: DB) {}

  /** Persist a subscription object. */
  save(sub: Subscription) {
    this.db.saveSubscription(sub);
  }

  /** Retrieve a subscription by id or return null. */
  get(id: string): Subscription | null {
    return this.db.getSubscription(id);
  }

  /** Check whether a webhook event id has already been processed. */
  isEventProcessed(eventId: string): boolean {
    return this.db.isEventProcessed(eventId);
  }

  /** Mark a webhook event id as processed for idempotency. */
  markEventProcessed(eventId: string) {
    this.db.markEventProcessed(eventId);
  }

  /** Persist an invoice record. */
  saveInvoice(id: string, subId: string, amount: number, status: 'paid' | 'failed' | 'refunded', type: string) {
    this.db.saveInvoice(id, subId, amount, status, type);
  }

  /** Get a single invoice by id. */
  getInvoice(id: string) {
    return this.db.getInvoice(id);
  }

  /** Get invoices for a subscription. */
  getInvoices(subId: string) {
    return this.db.getInvoices(subId);
  }

  /** Log a subscription-level audit/event entry. */
  logEvent(id: string, subId: string, eventType: string, details: string) {
    this.db.logSubscriptionEvent(id, subId, eventType, details);
  }

  /** Retrieve subscription audit events. */
  getEvents(subId: string) {
    return this.db.getSubscriptionEvents(subId);
  }
}
