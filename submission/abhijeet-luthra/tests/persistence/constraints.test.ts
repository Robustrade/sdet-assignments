import { createDatabase, Db } from '../../src/db/database';
import { seedReferenceData } from '../../src/db/seed';
import { createRepositories, Repositories } from '../../src/repositories';

/** DB-04: the database itself rejects duplicate identities and illegal values. */
describe('DB-04 database constraints', () => {
  const now = '2026-01-01T00:00:00.000Z';
  let db: Db;
  let repos: Repositories;

  beforeEach(() => {
    db = createDatabase();
    repos = createRepositories(db);
    seedReferenceData(repos, now);
    repos.subscriptions.insert({
      id: 'sub_1', customerId: 'cust_001', planId: 'basic', paymentMethodId: 'pm_x', status: 'trialing',
      trialEnd: now, currentPeriodEnd: null, createdAt: now, updatedAt: now, canceledAt: null,
    });
    repos.invoices.insert({
      id: 'inv_1', subscriptionId: 'sub_1', amountMinor: 1900, currency: 'USD', status: 'open',
      periodStart: now, periodEnd: now, createdAt: now, updatedAt: now,
    });
  });
  afterEach(() => db.close());

  const payment = (id: string, attemptNumber: number, idempotencyKey: string) => ({
    id, invoiceId: 'inv_1', subscriptionId: 'sub_1', attemptNumber, idempotencyKey, providerReference: null,
    amountMinor: 1900, currency: 'USD', status: 'pending' as const, failureCode: null, createdAt: now, updatedAt: now,
  });

  const event = (eventId: string) => ({
    eventId, eventType: 'payment.succeeded', subscriptionId: 'sub_1', invoiceId: 'inv_1', providerReference: null,
    payload: '{}', processingStatus: 'processed' as const, ignoreReason: null, matchedPaymentId: null,
    deliveryCount: 1, firstReceivedAt: now, lastReceivedAt: now,
  });

  test('duplicate webhook event_id is rejected', () => {
    repos.webhookEvents.insert(event('evt_1'));
    expect(() => repos.webhookEvents.insert(event('evt_1'))).toThrow(/UNIQUE/);
  });

  test('duplicate payment idempotency key is rejected', () => {
    repos.payments.insert(payment('pay_1', 1, 'inv_1:1'));
    expect(() => repos.payments.insert(payment('pay_2', 2, 'inv_1:1'))).toThrow(/UNIQUE/);
  });

  test('two attempts with the same number on one invoice are rejected', () => {
    repos.payments.insert(payment('pay_1', 1, 'inv_1:1'));
    expect(() => repos.payments.insert(payment('pay_2', 1, 'other-key'))).toThrow(/UNIQUE/);
  });

  test('a fifth subscription status is rejected', () => {
    const sub = repos.subscriptions.findById('sub_1')!;
    expect(() => repos.subscriptions.update({ ...sub, status: 'pending' as never })).toThrow(/CHECK/);
  });

  test('an unknown payment status is rejected', () => {
    repos.payments.insert(payment('pay_1', 1, 'inv_1:1'));
    const p = repos.payments.findById('pay_1')!;
    expect(() => repos.payments.update({ ...p, status: 'maybe' as never })).toThrow(/CHECK/);
  });

  test('a duplicate client Idempotency-Key is rejected', () => {
    repos.idempotencyKeys.insert({ key: 'k1', requestHash: 'h', subscriptionId: 'sub_1', createdAt: now });
    expect(() => repos.idempotencyKeys.insert({ key: 'k1', requestHash: 'h2', subscriptionId: 'sub_1', createdAt: now })).toThrow(
      /UNIQUE/,
    );
  });

  test('a payment for a non-existent invoice is rejected (foreign key)', () => {
    expect(() => repos.payments.insert({ ...payment('pay_x', 1, 'k'), invoiceId: 'inv_missing' })).toThrow(/FOREIGN KEY/);
  });
});
