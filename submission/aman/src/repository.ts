import type { AuditEntry, Invoice, Subscription, WebhookEvent } from './domain.ts';
export interface BillingRepository {
  subscriptions: Map<string, Subscription>;
  invoices: Map<string, Invoice>;
  webhookEvents: Map<string, WebhookEvent>;
  webhookDeliveries: Array<{ eventId: string; disposition: string; at: string }>;
  audit: AuditEntry[];
  reset(): void;
}
export class InMemoryBillingRepository implements BillingRepository {
  subscriptions = new Map<string, Subscription>();
  invoices = new Map<string, Invoice>();
  webhookEvents = new Map<string, WebhookEvent>();
  webhookDeliveries: Array<{ eventId: string; disposition: string; at: string }> = [];
  audit: AuditEntry[] = [];
  reset(): void {
    this.subscriptions.clear(); this.invoices.clear(); this.webhookEvents.clear();
    this.webhookDeliveries.length = 0; this.audit.length = 0;
  }
}
