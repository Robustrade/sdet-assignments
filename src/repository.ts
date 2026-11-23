import { AuditRecord, Invoice, Subscription, SubscriptionStatus, WebhookEvent } from "./domain";

export class InMemoryRepository {
  readonly subscriptions = new Map<string, Subscription>();
  readonly invoices = new Map<string, Invoice>();
  readonly webhookEvents = new Map<string, WebhookEvent>();
  readonly audit: AuditRecord[] = [];
  private auditSequence = 1;

  clear(): void {
    this.subscriptions.clear();
    this.invoices.clear();
    this.webhookEvents.clear();
    this.audit.splice(0);
    this.auditSequence = 1;
  }

  recordAudit(subscriptionId: string, fromStatus: SubscriptionStatus, toStatus: SubscriptionStatus, trigger: string): void {
    this.audit.push({
      id: this.auditSequence++,
      subscriptionId,
      fromStatus,
      toStatus,
      trigger,
      createdAt: new Date().toISOString()
    });
  }
}
