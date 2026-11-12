import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Db } from '../../src/persistence/database';
import { createRepositories, type Repositories } from '../../src/persistence/repositories';

/**
 * Schema check (`npm run validate-schema`). This is the only spec that uses raw SQL,
 * because it tests the constraints themselves, which the repositories never let us break.
 */
describe('database schema', () => {
  let db: Db;
  let repos: Repositories;

  beforeEach(() => {
    db = createDatabase();
    repos = createRepositories(db);
    repos.customers.insert({ id: 'cust_1', email: 'cust_1@example.test' });
    repos.paymentMethods.insert({ id: 'pm_1', customerId: 'cust_1' });
  });

  afterEach(() => {
    db.close();
  });

  function insertSubscription(id: string, status: string, canceledAt: string | null): void {
    db.prepare(
      `INSERT INTO subscriptions (id, customer_id, payment_method_id, plan, status, trial_ends_at, current_period_end, canceled_at, created_at, updated_at)
       VALUES (@id, 'cust_1', 'pm_1', 'pro', @status, '2026-01-01T00:00:00.000Z', NULL, @canceledAt, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run({ id, status, canceledAt });
  }

  function insertInvoice(id: string, idempotencyKey: string, amountCents: number): void {
    db.prepare(
      `INSERT INTO invoices (id, subscription_id, amount_cents, currency, status, idempotency_key, provider_charge_id, failure_reason, created_at, updated_at)
       VALUES (@id, 'sub_1', @amountCents, 'USD', 'pending', @idempotencyKey, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run({ id, idempotencyKey, amountCents });
  }

  it('creates all the tables the service and the tests rely on', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);

    expect(tables).toEqual(['customers', 'invoices', 'payment_methods', 'subscription_events', 'subscriptions', 'webhook_events']);
  });

  it('rejects a status that is not part of the lifecycle', () => {
    expect(() => insertSubscription('sub_1', 'paused', null)).toThrow(/CHECK constraint failed/);
  });

  it('requires canceled_at exactly when the status is canceled', () => {
    expect(() => insertSubscription('sub_1', 'canceled', null)).toThrow(/CHECK constraint failed/);
    expect(() => insertSubscription('sub_2', 'active', '2026-01-02T00:00:00.000Z')).toThrow(/CHECK constraint failed/);
    expect(() => insertSubscription('sub_3', 'canceled', '2026-01-02T00:00:00.000Z')).not.toThrow();
  });

  it('never stores two invoices with the same idempotency key', () => {
    insertSubscription('sub_1', 'trialing', null);
    insertInvoice('inv_1', 'key_1', 4900);
    expect(() => insertInvoice('inv_2', 'key_1', 4900)).toThrow(/UNIQUE constraint failed/);
  });

  it('rejects an invoice amount of zero or less', () => {
    insertSubscription('sub_1', 'trialing', null);
    expect(() => insertInvoice('inv_1', 'key_1', 0)).toThrow(/CHECK constraint failed/);
  });

  it('stores each webhook event id only once', () => {
    const event = {
      eventId: 'evt_1',
      type: 'payment.succeeded',
      subscriptionId: 'sub_1',
      invoiceId: 'inv_1',
      outcome: 'processed',
      receivedAt: '2026-01-01T00:00:00.000Z',
    } as const;
    repos.webhookEvents.insert(event);
    expect(() => repos.webhookEvents.insert(event)).toThrow(/UNIQUE constraint failed/);
  });

  it('does not allow an invoice for a subscription that does not exist', () => {
    expect(() => insertInvoice('inv_1', 'key_1', 4900)).toThrow(/FOREIGN KEY constraint failed/);
  });
});
