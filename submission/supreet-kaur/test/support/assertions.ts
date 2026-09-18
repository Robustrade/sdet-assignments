import assert from "node:assert/strict";
import { TestFixture } from "./TestFixture";
import { SubscriptionStatus } from "../../src/domain/states/State";

/**
 * Assertion/Verification Layer: wraps repository reads with business-meaningful checks so
 * scenario files express *what* must be true ("persisted state agrees with the API"), not
 * *how* to dig it out of storage. Every persistence check in the suite goes through
 * fixture.subscriptions / fixture.invoices / fixture.webhookEvents (the repositories) --
 * never through fixture.db directly. That indirection is what "validate persisted state via a
 * repository/DAO, not raw queries inline in tests" (from the assignment) means in practice.
 */
export function assertPersistedStatus(fixture: TestFixture, subscriptionId: string, expected: SubscriptionStatus): void {
  const persisted = fixture.subscriptions.findById(subscriptionId);
  assert.ok(persisted, `expected subscription '${subscriptionId}' to be persisted`);
  assert.equal(persisted!.status, expected, `persisted status for '${subscriptionId}'`);
}

/** Cross-checks that the API-visible status and the persisted (repository) status agree -- the invariant the assignment calls out explicitly. */
export function assertApiAndPersistenceAgree(fixture: TestFixture, apiStatus: string, subscriptionId: string): void {
  const persisted = fixture.subscriptions.findById(subscriptionId);
  assert.ok(persisted, `expected subscription '${subscriptionId}' to be persisted`);
  assert.equal(apiStatus, persisted!.status, "API-reported status must match persisted status");
}

export function assertInvoiceCount(fixture: TestFixture, subscriptionId: string, expected: number): void {
  const invoices = fixture.invoices.findBySubscriptionId(subscriptionId);
  assert.equal(invoices.length, expected, `invoice count for '${subscriptionId}'`);
}

export function assertNoContradictoryInvoice(fixture: TestFixture, subscriptionId: string): void {
  const sub = fixture.subscriptions.findById(subscriptionId);
  assert.ok(sub, `expected subscription '${subscriptionId}' to be persisted`);
  if (sub!.status === "active") {
    const invoices = fixture.invoices.findBySubscriptionId(subscriptionId);
    const hasSucceeded = invoices.some((inv) => inv.status === "succeeded");
    assert.ok(hasSucceeded, `an 'active' subscription must have at least one succeeded invoice, found: ${JSON.stringify(invoices.map((i) => i.status))}`);
  }
}
