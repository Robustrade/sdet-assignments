import { randomUUID } from "crypto";
import { AuditEvent, Invoice, InvoiceStatus, Subscription, SubscriptionState } from "../domain/types";

/**
 * Repository pattern: every persisted entity (subscriptions, invoices,
 * webhook_events, audit log) is accessed through this class. Production
 * code and test-verification code both go through it, instead of tests
 * reaching into whatever storage engine backs it.
 *
 * Backed by in-memory Maps so the fixture has no external dependency, but
 * the interface is deliberately query-shaped (find/list/count) so swapping
 * in a real database wouldn't change any caller.
 */
export class Repository {
  private subscriptions = new Map<string, Subscription>();
  private invoices = new Map<string, Invoice>();
  private processedWebhookEventIds = new Set<string>();
  private auditEvents: AuditEvent[] = [];

  // -- subscriptions --------------------------------------------------

  saveSubscription(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, subscription);
  }

  getSubscription(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  updateSubscriptionStatus(id: string, status: SubscriptionState, consecutiveFailures: number): void {
    const existing = this.subscriptions.get(id);
    if (!existing) throw new Error(`subscription ${id} not found`);
    this.subscriptions.set(id, {
      ...existing,
      status,
      consecutiveFailures,
      updatedAt: new Date().toISOString(),
    });
  }

  countSubscriptions(): number {
    return this.subscriptions.size;
  }

  // -- invoices ---------------------------------------------------------

  saveInvoice(invoice: Invoice): void {
    this.invoices.set(invoice.id, invoice);
  }

  getInvoice(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  updateInvoiceStatus(id: string, status: InvoiceStatus): void {
    const existing = this.invoices.get(id);
    if (!existing) throw new Error(`invoice ${id} not found`);
    this.invoices.set(id, { ...existing, status, updatedAt: new Date().toISOString() });
  }

  listInvoicesForSubscription(subscriptionId: string): Invoice[] {
    return [...this.invoices.values()].filter((inv) => inv.subscriptionId === subscriptionId);
  }

  // -- webhook idempotency ----------------------------------------------

  hasProcessedWebhookEvent(eventId: string): boolean {
    return this.processedWebhookEventIds.has(eventId);
  }

  markWebhookEventProcessed(eventId: string): void {
    this.processedWebhookEventIds.add(eventId);
  }

  countProcessedWebhookEvents(): number {
    return this.processedWebhookEventIds.size;
  }

  // -- audit log ----------------------------------------------------------

  recordAuditEvent(subscriptionId: string, eventType: string, detail: string): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      subscriptionId,
      eventType,
      detail,
      createdAt: new Date().toISOString(),
    };
    this.auditEvents.push(event);
    return event;
  }

  listAuditEvents(subscriptionId: string): AuditEvent[] {
    return this.auditEvents.filter((e) => e.subscriptionId === subscriptionId);
  }

  countAuditEvents(subscriptionId: string): number {
    return this.listAuditEvents(subscriptionId).length;
  }
}
