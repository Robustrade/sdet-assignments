import { Invoice, Payment, Subscription } from '../../../src/domain/types';
import { presentSubscription } from '../../../src/http/presenters';
import { ChargeRequest } from '../../../src/providers/payment-provider';
import { DatabaseSnapshot } from '../../../src/repositories/snapshot-repository';
import { TestEnvironment } from '../fixtures/test-environment';

/** DB-INV-07: what the API returns is exactly what is persisted. */
export async function expectApiMatchesDb(env: TestEnvironment, subscriptionId: string): Promise<Subscription> {
  const persisted = env.repos.subscriptions.findById(subscriptionId);
  expect(persisted).toBeDefined();
  const res = await env.api.get(subscriptionId);
  expect(res.status).toBe(200);
  expect(res.body).toEqual(presentSubscription(persisted!));
  return persisted!;
}

/** Proves a request changed nothing: compares full-table snapshots. */
export function expectNoDatabaseChanges(env: TestEnvironment, before: DatabaseSnapshot): void {
  expect(env.repos.snapshots.snapshot()).toEqual(before);
}

/** The exact arguments the provider must receive for a given attempt - not just "was called". */
export function expectedChargeRequest(subscription: Subscription, invoice: Invoice, attemptNumber: number): ChargeRequest {
  return {
    idempotencyKey: `${invoice.id}:${attemptNumber}`,
    invoiceId: invoice.id,
    customerId: subscription.customerId,
    paymentMethodId: subscription.paymentMethodId,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
  };
}

export function statuses(payments: Payment[]): string[] {
  return payments.map((p) => p.status);
}
