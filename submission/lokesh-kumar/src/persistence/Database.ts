import type { AuditEntry, Invoice, Subscription, WebhookEventRecord } from '../domain/types.js';

/** In-memory tables. One instance per test run keeps tests fully isolated. */
export class Database {
  readonly customers = new Set<string>();
  readonly subscriptions = new Map<string, Subscription>();
  readonly invoices = new Map<string, Invoice>();
  readonly webhookEvents = new Map<string, WebhookEventRecord>();
  readonly auditLog: AuditEntry[] = [];
}
