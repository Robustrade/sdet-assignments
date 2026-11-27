/**
 * Independent SQLite query inspector for verifying persisted billing state.
 * Queries raw sql.js directly without importing SUT repositories.
 * Author: Vedant Dalkari
 */

import type { BindParams, Database, SqlValue } from 'sql.js';
import type {
  CustomerRecord,
  InvoiceRecord,
  PaymentAttemptRecord,
  SubscriptionAuditRecord,
  SubscriptionRecord,
  WebhookEventRecord,
} from '../../../src/domain/types.js';

export type LedgerTableName =
  | 'customers'
  | 'subscriptions'
  | 'invoices'
  | 'payment_attempts'
  | 'webhook_events'
  | 'subscription_audit_log';

export interface TableCounts {
  readonly customers: number;
  readonly subscriptions: number;
  readonly invoices: number;
  readonly payment_attempts: number;
  readonly webhook_events: number;
  readonly subscription_audit_log: number;
}

export class LedgerInspector {
  private readonly db: Database;

  public constructor(db: Database) {
    this.db = db;
  }

  public executeRaw(sql: string, params?: BindParams): void {
    if (params !== undefined) {
      this.db.run(sql, params);
      return;
    }
    this.db.run(sql);
  }

  public queryRows<T extends Record<string, SqlValue>>(sql: string, params?: BindParams): T[] {
    const stmt = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      if (params !== undefined) {
        stmt.bind(params);
      }
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as unknown as T);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }

  public listTables(): string[] {
    const rows = this.queryRows<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return rows.map((row) => row.name);
  }

  public hasTable(tableName: string): boolean {
    return this.listTables().includes(tableName);
  }

  public hasAllBillingTables(): boolean {
    const tables = new Set(this.listTables());
    const required: readonly LedgerTableName[] = [
      'customers',
      'subscriptions',
      'invoices',
      'payment_attempts',
      'webhook_events',
      'subscription_audit_log',
    ];
    return required.every((name) => tables.has(name));
  }

  public getTableColumns(tableName: string): string[] {
    const rows = this.queryRows<{ name: string }>(`PRAGMA table_info(${tableName})`);
    return rows.map((row) => row.name);
  }

  public countRows(table: LedgerTableName): number {
    const rows = this.queryRows<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM ${table}`);
    return Number(rows[0]?.cnt ?? 0);
  }

  public countAllTables(): TableCounts {
    return {
      customers: this.countRows('customers'),
      subscriptions: this.countRows('subscriptions'),
      invoices: this.countRows('invoices'),
      payment_attempts: this.countRows('payment_attempts'),
      webhook_events: this.countRows('webhook_events'),
      subscription_audit_log: this.countRows('subscription_audit_log'),
    };
  }

  public findCustomerById(id: string): CustomerRecord | null {
    const rows = this.queryRows<Record<string, SqlValue>>(
      'SELECT id, email, name, created_at FROM customers WHERE id = ?',
      [id],
    );
    return (rows[0] as unknown as CustomerRecord | undefined) ?? null;
  }

  public findSubscriptionById(id: string): SubscriptionRecord | null {
    const rows = this.queryRows<Record<string, SqlValue>>(
      'SELECT id, customer_id, plan, status, payment_method_id, failed_attempts, trial_ends_at, current_period_start, current_period_end, canceled_at, created_at, updated_at FROM subscriptions WHERE id = ?',
      [id],
    );
    return (rows[0] as unknown as SubscriptionRecord | undefined) ?? null;
  }

  public listSubscriptions(): SubscriptionRecord[] {
    const rows = this.queryRows<Record<string, SqlValue>>(
      'SELECT id, customer_id, plan, status, payment_method_id, failed_attempts, trial_ends_at, current_period_start, current_period_end, canceled_at, created_at, updated_at FROM subscriptions ORDER BY rowid ASC',
    );
    return rows as unknown as SubscriptionRecord[];
  }

  public listInvoices(subscriptionId?: string): InvoiceRecord[] {
    if (subscriptionId !== undefined) {
      return this.queryRows<Record<string, SqlValue>>(
        'SELECT id, subscription_id, amount_cents, currency, status, period_start, period_end, created_at, updated_at FROM invoices WHERE subscription_id = ? ORDER BY rowid ASC',
        [subscriptionId],
      ) as unknown as InvoiceRecord[];
    }
    return this.queryRows<Record<string, SqlValue>>(
      'SELECT id, subscription_id, amount_cents, currency, status, period_start, period_end, created_at, updated_at FROM invoices ORDER BY rowid ASC',
    ) as unknown as InvoiceRecord[];
  }

  public findInvoiceById(id: string): InvoiceRecord | null {
    const rows = this.queryRows<Record<string, SqlValue>>(
      'SELECT id, subscription_id, amount_cents, currency, status, period_start, period_end, created_at, updated_at FROM invoices WHERE id = ?',
      [id],
    );
    return (rows[0] as unknown as InvoiceRecord | undefined) ?? null;
  }

  public listPaymentAttempts(subscriptionId?: string): PaymentAttemptRecord[] {
    if (subscriptionId !== undefined) {
      return this.queryRows<Record<string, SqlValue>>(
        'SELECT id, invoice_id, subscription_id, idempotency_key, amount_cents, currency, status, provider_reference, failure_reason, created_at FROM payment_attempts WHERE subscription_id = ? ORDER BY rowid ASC',
        [subscriptionId],
      ) as unknown as PaymentAttemptRecord[];
    }
    return this.queryRows<Record<string, SqlValue>>(
      'SELECT id, invoice_id, subscription_id, idempotency_key, amount_cents, currency, status, provider_reference, failure_reason, created_at FROM payment_attempts ORDER BY rowid ASC',
    ) as unknown as PaymentAttemptRecord[];
  }

  public listWebhookEvents(eventId?: string): WebhookEventRecord[] {
    if (eventId !== undefined) {
      return this.queryRows<Record<string, SqlValue>>(
        'SELECT event_id, event_type, subscription_id, invoice_id, outcome, payload_hash, received_at FROM webhook_events WHERE event_id = ? ORDER BY rowid ASC',
        [eventId],
      ) as unknown as WebhookEventRecord[];
    }
    return this.queryRows<Record<string, SqlValue>>(
      'SELECT event_id, event_type, subscription_id, invoice_id, outcome, payload_hash, received_at FROM webhook_events ORDER BY rowid ASC',
    ) as unknown as WebhookEventRecord[];
  }

  public listAuditLogs(subscriptionId?: string): SubscriptionAuditRecord[] {
    if (subscriptionId !== undefined) {
      return this.queryRows<Record<string, SqlValue>>(
        'SELECT id, subscription_id, from_status, to_status, trigger, actor, metadata_json, created_at FROM subscription_audit_log WHERE subscription_id = ? ORDER BY rowid ASC',
        [subscriptionId],
      ) as unknown as SubscriptionAuditRecord[];
    }
    return this.queryRows<Record<string, SqlValue>>(
      'SELECT id, subscription_id, from_status, to_status, trigger, actor, metadata_json, created_at FROM subscription_audit_log ORDER BY rowid ASC',
    ) as unknown as SubscriptionAuditRecord[];
  }
}
