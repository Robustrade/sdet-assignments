import { createHmac } from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import type Database from 'better-sqlite3';

import { createApp } from '../../src/app';
import { createDatabase } from '../../src/database/connection';
import { MockPaymentProvider } from '../../src/providers/mock-payment-provider';
import type { PaymentWebhookPayload } from '../../builders/webhook-event.builder';

export const TEST_WEBHOOK_SECRET = 'test-webhook-secret';

export class SubscriptionApiClient {
  constructor(private readonly app: Express) {}

  createSubscription(payload: { customer_id?: string; plan?: string }) {
    return request(this.app).post('/subscriptions').send(payload);
  }

  getSubscription(id: string) {
    return request(this.app).get(`/subscriptions/${id}`);
  }

  cancelSubscription(id: string) {
    return request(this.app).post(`/subscriptions/${id}/cancel`);
  }

  pay(id: string) {
    return request(this.app).post(`/subscriptions/${id}/pay`);
  }

  sendWebhook(
    payload: PaymentWebhookPayload | Record<string, unknown>,
    signature: 'valid' | 'invalid' | 'missing' = 'valid'
  ) {
    const body = JSON.stringify(payload);
    const test = request(this.app)
      .post('/webhooks/payment-provider')
      .set('Content-Type', 'application/json');

    if (signature === 'missing') {
      return test.send(body);
    }

    const value = signature === 'valid'
      ? createHmac('sha256', TEST_WEBHOOK_SECRET).update(body).digest('hex')
      : 'invalid-signature';

    return test.set('X-Provider-Signature', value).send(body);
  }
}

interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan: string;
  status: string;
  created_at: string;
  updated_at: string;
  canceled_at: string | null;
}

interface InvoiceRow {
  id: string;
  subscription_id: string;
  amount: number;
  status: string;
  created_at: string;
}

interface PaymentRow {
  id: string;
  invoice_id: string;
  transaction_id: string | null;
  amount: number;
  status: string;
  created_at: string;
}

interface AuditRow {
  old_status: string | null;
  new_status: string;
  reason: string;
  created_at: string;
}

export class SubscriptionPersistence {
  constructor(private readonly database: Database.Database) {}

  subscription(id: string): SubscriptionRow | undefined {
    return this.database.prepare(`
      SELECT * FROM subscriptions WHERE id = ?
    `).get(id) as SubscriptionRow | undefined;
  }

  invoicesFor(subscriptionId: string): InvoiceRow[] {
    return this.database.prepare(`
      SELECT * FROM invoices WHERE subscription_id = ? ORDER BY created_at, id
    `).all(subscriptionId) as InvoiceRow[];
  }

  paymentsFor(invoiceId: string): PaymentRow[] {
    return this.database.prepare(`
      SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at, id
    `).all(invoiceId) as PaymentRow[];
  }

  webhookEventCount(eventId: string): number {
    const row = this.database.prepare(`
      SELECT COUNT(*) AS count FROM webhook_events WHERE event_id = ?
    `).get(eventId) as { count: number };
    return row.count;
  }

  auditFor(subscriptionId: string): AuditRow[] {
    return this.database.prepare(`
      SELECT old_status, new_status, reason, created_at
      FROM audit_logs
      WHERE subscription_id = ?
      ORDER BY id
    `).all(subscriptionId) as AuditRow[];
  }

  count(table: 'subscriptions' | 'invoices' | 'payments' | 'webhook_events'): number {
    const row = this.database.prepare(
      `SELECT COUNT(*) AS count FROM ${table}`
    ).get() as { count: number };
    return row.count;
  }

  seedPaymentAttempt(
    subscriptionId: string,
    invoiceId: string,
    paymentId: string,
    amount = 1000,
    status = 'pending'
  ): void {
    const createdAt = new Date().toISOString();
    this.database.prepare(`
      INSERT INTO invoices (id, subscription_id, amount, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(invoiceId, subscriptionId, amount, status, createdAt);
    this.database.prepare(`
      INSERT INTO payments
        (id, invoice_id, transaction_id, amount, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(paymentId, invoiceId, `txn-${paymentId}`, amount, status, createdAt);
  }
}

export class SubscriptionTestFixture {
  readonly database: Database.Database;
  readonly provider: MockPaymentProvider;
  readonly app: Express;
  readonly api: SubscriptionApiClient;
  readonly persistence: SubscriptionPersistence;

  constructor() {
    this.database = createDatabase();
    this.provider = new MockPaymentProvider();
    this.app = createApp({
      database: this.database,
      provider: this.provider,
      webhookSecret: TEST_WEBHOOK_SECRET
    });
    this.api = new SubscriptionApiClient(this.app);
    this.persistence = new SubscriptionPersistence(this.database);
  }

  close(): void {
    this.database.close();
  }
}
