import { SUBSCRIPTION_STATUSES } from '../../../src/domain/types';
import { Repositories } from '../../../src/repositories';

/**
 * Cross-table business invariants (docs/DATABASE_DESIGN.md §7). Runs after EVERY
 * test via TestEnvironment, so a test that leaves contradictory data fails even
 * if its own assertions passed. Returns human-readable violations.
 */
export function findInvariantViolations(repos: Repositories): string[] {
  const violations: string[] = [];
  const fail = (rule: string, message: string) => violations.push(`${rule}: ${message}`);

  for (const sub of repos.subscriptions.findAll()) {
    const plan = repos.plans.findById(sub.planId)!;
    const payments = repos.payments.findBySubscription(sub.id);
    const audit = repos.subscriptionEvents.findBySubscription(sub.id);

    if (!SUBSCRIPTION_STATUSES.includes(sub.status)) fail('DB-INV-01', `${sub.id} has status ${sub.status}`);

    // DB-INV-02: active only with a successful (possibly later refunded) payment.
    if (sub.status === 'active' && !payments.some((p) => p.status === 'succeeded' || p.status === 'refunded')) {
      fail('DB-INV-02', `${sub.id} is active without any successful payment`);
    }

    // DB-INV-08: audit history is complete, gap-free and ends at the current status.
    if (audit.length === 0) fail('DB-INV-08', `${sub.id} has no audit history`);
    audit.forEach((event, i) => {
      if (event.sequence !== i + 1) fail('DB-INV-08', `${sub.id} audit sequence gap at ${event.sequence}`);
      const expectedPrevious = i === 0 ? null : audit[i - 1].newStatus;
      if (event.previousStatus !== expectedPrevious) fail('DB-INV-08', `${sub.id} audit chain broken at ${event.sequence}`);
    });
    if (audit.length > 0 && audit[audit.length - 1].newStatus !== sub.status) {
      fail('DB-INV-08', `${sub.id} latest audit status ${audit[audit.length - 1].newStatus} != ${sub.status}`);
    }

    // DB-INV-10: nothing is charged after cancellation.
    if (sub.canceledAt && payments.some((p) => p.createdAt > sub.canceledAt!)) {
      fail('DB-INV-10', `${sub.id} has a payment attempt created after cancellation`);
    }

    for (const invoice of repos.invoices.findBySubscription(sub.id)) {
      // DB-INV-12: plan price/currency applied consistently.
      if (invoice.amountMinor !== plan.priceMinor || invoice.currency !== plan.currency) {
        fail('DB-INV-12', `${invoice.id} amount ${invoice.amountMinor} ${invoice.currency} != plan ${plan.priceMinor} ${plan.currency}`);
      }
      const attempts = repos.payments.findByInvoice(invoice.id);
      for (const p of attempts) {
        if (p.subscriptionId !== invoice.subscriptionId) fail('DB-INV-03', `${p.id} subscription differs from its invoice`);
        if (p.amountMinor !== invoice.amountMinor) fail('DB-INV-12', `${p.id} amount differs from its invoice`);
      }
      const settled = attempts.filter((p) => p.status === 'succeeded' || p.status === 'refunded');
      // DB-INV-05: at most one successful payment per invoice.
      if (settled.length > 1) fail('DB-INV-05', `${invoice.id} has ${settled.length} successful payments`);
      // DB-INV-06: invoice status agrees with its payments.
      const succeeded = attempts.filter((p) => p.status === 'succeeded').length;
      const refunded = attempts.filter((p) => p.status === 'refunded').length;
      if (invoice.status === 'paid' && !(succeeded === 1 && refunded === 0)) fail('DB-INV-06', `${invoice.id} paid without exactly one succeeded payment`);
      if (invoice.status === 'refunded' && refunded !== 1) fail('DB-INV-06', `${invoice.id} refunded without a refunded payment`);
      if ((invoice.status === 'open' || invoice.status === 'void') && settled.length > 0) {
        fail('DB-INV-06', `${invoice.id} is ${invoice.status} but has a successful payment`);
      }
    }
  }
  return violations;
}
