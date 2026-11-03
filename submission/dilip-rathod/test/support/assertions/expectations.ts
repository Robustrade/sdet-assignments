import { expect } from 'vitest';
import type { ChargeRequest } from '../../../src/payments/PaymentProvider';
import type { InvoiceDto, SubscriptionDto } from '../api/contracts';
import type { TestEnvironment } from '../env/TestEnvironment';
import type { TableCounts } from '../persistence/PersistenceInspector';
import type { MockPaymentProvider } from '../provider/MockPaymentProvider';

export interface ExpectedSubscriptionState {
  status: SubscriptionDto['status'];
  plan?: string;
  retryCount?: number;
  /** Invoice statuses in period order, checked in both the API listing and the database. */
  invoices?: Array<InvoiceDto['status']>;
  /** Exact status history from the audit log, e.g. ['∅->trialing', 'trialing->active']. */
  history?: string[];
}

/**
 * Asserts a subscription's state through the API *and* the database, and that the two agree.
 * Returns the API view for further assertions.
 */
export async function expectSubscriptionState(env: TestEnvironment, id: string, expected: ExpectedSubscriptionState): Promise<SubscriptionDto> {
  const api = await env.api.get(id);
  const row = env.db.subscription(id);

  expect(row, `subscription ${id} is persisted`).toBeDefined();
  expect(api.status, 'API status').toBe(expected.status);
  expect(row!.status, 'persisted status').toBe(expected.status);
  if (expected.plan) {
    expect(api.plan).toBe(expected.plan);
    expect(row!.plan).toBe(expected.plan);
  }
  if (expected.retryCount !== undefined) {
    expect(api.retry_count).toBe(expected.retryCount);
    expect(row!.retry_count).toBe(expected.retryCount);
  }
  if (expected.invoices) {
    const apiInvoices = await env.api.invoices(id);
    expect(apiInvoices.map((i) => i.status), 'API invoice statuses').toEqual(expected.invoices);
    expect(env.db.invoicesFor(id).map((i) => i.status), 'persisted invoice statuses').toEqual(expected.invoices);
  }
  if (expected.history) {
    expect(env.db.statusHistory(id), 'audit status history').toEqual(expected.history);
  }
  return api;
}

export function expectCharges(provider: MockPaymentProvider, expected: Array<Partial<ChargeRequest>>): void {
  expect(provider.callCount, `provider calls: ${JSON.stringify(provider.requests)}`).toBe(expected.length);
  expected.forEach((request, i) => expect(provider.requests[i]).toEqual(expect.objectContaining(request)));
}

export function expectNoCharges(provider: MockPaymentProvider): void {
  expectCharges(provider, []);
}

/** Every table has exactly as many rows as before, except the listed deltas. */
export function expectRowDeltas(before: TableCounts, after: TableCounts, deltas: Partial<TableCounts> = {}): void {
  const actual = Object.fromEntries(Object.keys(before).map((t) => [t, after[t as keyof TableCounts] - before[t as keyof TableCounts]]));
  const wanted = Object.fromEntries(Object.keys(before).map((t) => [t, deltas[t as keyof TableCounts] ?? 0]));
  expect(actual, 'row count changes per table').toEqual(wanted);
}
