import { expect } from 'vitest';
import { SubscriptionRepository } from '../../src/repository';
import { SubscriptionStatus } from '../../src/types';
import { ApiClient } from './ApiClient';
import { MockPaymentProvider } from './MockPaymentProvider';

/**
 * Verifies that GET /subscriptions/:id matches the persisted subscription row in the repository.
 */
export async function expectApiMatchesDb(
  api: ApiClient,
  repo: SubscriptionRepository,
  subscriptionId: string
): Promise<void> {
  const apiRes = await api.getSubscription(subscriptionId);
  const dbSub = repo.findSubscriptionById(subscriptionId);

  expect(dbSub).toBeDefined();
  expect(apiRes.status).toBe(200);
  expect(apiRes.body.id).toBe(dbSub!.id);
  expect(apiRes.body.customer_id).toBe(dbSub!.customer_id);
  expect(apiRes.body.plan).toBe(dbSub!.plan);
  expect(apiRes.body.status).toBe(dbSub!.status);
  expect(apiRes.body.payment_method_id).toBe(dbSub!.payment_method_id);
  expect(apiRes.body.retry_count).toBe(dbSub!.retry_count);
  expect(apiRes.body.trial_ends_at).toBe(dbSub!.trial_ends_at);
  expect(apiRes.body.created_at).toBe(dbSub!.created_at);
  expect(apiRes.body.updated_at).toBe(dbSub!.updated_at);
}

/**
 * Asserts that MockPaymentProvider was called with expected customer, amount, payment method, and reference.
 */
export function expectProviderCalledWith(
  provider: MockPaymentProvider,
  expected: {
    customerId: string;
    amount: number;
    paymentMethodId: string;
    idempotencyRef?: string | RegExp;
    callIndex?: number;
  }
): void {
  const calls = provider.getCalls();
  const idx = expected.callIndex ?? calls.length - 1;
  expect(calls.length).toBeGreaterThan(idx);

  const call = calls[idx];
  expect(call.customerId).toBe(expected.customerId);
  expect(call.amount).toBe(expected.amount);
  expect(call.paymentMethodId).toBe(expected.paymentMethodId);

  if (expected.idempotencyRef instanceof RegExp) {
    expect(call.idempotencyRef).toMatch(expected.idempotencyRef);
  } else if (expected.idempotencyRef !== undefined) {
    expect(call.idempotencyRef).toBe(expected.idempotencyRef);
  } else {
    expect(call.idempotencyRef).toBeTruthy();
  }
}

/**
 * Asserts no duplicate invoice IDs or idempotency references exist for a subscription (and optional exact count).
 */
export function expectNoDuplicateInvoices(
  repo: SubscriptionRepository,
  subscriptionId: string,
  expectedCount?: number
): void {
  const invoices = repo.findInvoicesBySubscriptionId(subscriptionId);
  const ids = new Set(invoices.map((i) => i.id));
  const refs = new Set(invoices.map((i) => i.idempotency_ref));

  expect(ids.size).toBe(invoices.length);
  expect(refs.size).toBe(invoices.length);

  if (expectedCount !== undefined) {
    expect(invoices).toHaveLength(expectedCount);
  }
}

/**
 * Invariant: a subscription is never 'active' without at least one persisted 'paid' invoice.
 */
export function expectNeverActiveWithoutPaidInvoice(
  repo: SubscriptionRepository,
  subscriptionId: string
): void {
  const sub = repo.findSubscriptionById(subscriptionId);
  expect(sub).toBeDefined();

  const paidInvoices = repo
    .findInvoicesBySubscriptionId(subscriptionId)
    .filter((inv) => inv.status === 'paid');

  if (sub!.status === 'active') {
    expect(paidInvoices.length).toBeGreaterThanOrEqual(1);
  }
}

/**
 * Verifies the chronological audit_log status transitions and monotonic timestamps for a subscription.
 */
export function expectAuditTrail(
  repo: SubscriptionRepository,
  subscriptionId: string,
  expectedTransitions: Array<{ from: SubscriptionStatus | null; to: SubscriptionStatus }>
): void {
  const logs = repo.findAuditLogsBySubscriptionId(subscriptionId);
  const actual = logs.map((l) => ({ from: l.from_status, to: l.to_status }));
  expect(actual).toEqual(expectedTransitions);

  for (let i = 1; i < logs.length; i++) {
    expect(Date.parse(logs[i].created_at)).toBeGreaterThanOrEqual(Date.parse(logs[i - 1].created_at));
  }
}
