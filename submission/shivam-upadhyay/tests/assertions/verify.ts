import { expect } from 'vitest';
import type { Invoice } from '../../src/types';
import type { TestContext } from '../fixtures/setup';

/** Assertion layer: persisted state is checked via the store, never raw inline queries. */

export function expectState(ctx: TestContext, id: string, state: string): void {
  const sub = ctx.store.subscriptions.get(id);
  expect(sub, `subscription ${id} should exist`).toBeDefined();
  expect(sub?.state).toBe(state);
}

export function invoicesFor(ctx: TestContext, subscriptionId: string): Invoice[] {
  return [...ctx.store.invoices.values()].filter((i) => i.subscriptionId === subscriptionId);
}

export function expectInvoiceCount(ctx: TestContext, subscriptionId: string, count: number): void {
  expect(invoicesFor(ctx, subscriptionId)).toHaveLength(count);
}

export function expectInvoice(
  ctx: TestContext,
  subscriptionId: string,
  status: Invoice['status'],
  amountCents: number,
): void {
  const found = invoicesFor(ctx, subscriptionId).find(
    (i) => i.status === status && i.amountCents === amountCents,
  );
  expect(found, `expected a ${status} invoice for ${amountCents}`).toBeDefined();
}

export function expectProviderCalls(ctx: TestContext, count: number): void {
  expect(ctx.mock.calls).toHaveLength(count);
}

export function expectAuditKind(ctx: TestContext, subscriptionId: string, kind: string): void {
  const kinds = ctx.store.auditLog.filter((e) => e.subscriptionId === subscriptionId).map((e) => e.kind);
  expect(kinds).toContain(kind);
}
