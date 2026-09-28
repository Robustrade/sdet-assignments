import { SubscriptionStateMachine, type LifecycleEvent } from '../../src/domain/SubscriptionStateMachine';
import type { PlanCatalog } from '../../src/domain/plans';
import type { Repositories } from '../../src/persistence/repositories';
import type { MockPaymentProvider } from './MockPaymentProvider';

/**
 * Global business invariants, evaluated against the WHOLE database.
 * Specs call `assertHolds()` in afterEach, so every test - whatever it is
 * about - also proves no contradictory records were left behind.
 *
 * Returns human-readable violations instead of throwing on the first one,
 * which makes failures far easier to diagnose.
 */
export class InvariantChecker {
  constructor(
    private readonly repos: Repositories,
    private readonly catalog: PlanCatalog,
    private readonly provider?: MockPaymentProvider,
  ) {}

  violations(): string[] {
    const v: string[] = [];
    const { subscriptions, invoices, payments, audit, webhookEvents } = this.repos;

    for (const sub of subscriptions.all()) {
      const subPayments = payments.findBySubscription(sub.id);
      const plan = this.catalog.get(sub.plan);

      // I1: active never exists without a successful, persisted payment
      if (sub.status === 'active' && !subPayments.some((p) => p.status === 'succeeded')) {
        v.push(`I1 ${sub.id} is active without any succeeded payment`);
      }
      // I8: canceledAt coherent with status
      if ((sub.status === 'canceled') !== (sub.canceledAt !== null)) {
        v.push(`I8 ${sub.id} status=${sub.status} but canceledAt=${sub.canceledAt}`);
      }
      // I12: timestamps
      if (sub.updatedAt < sub.createdAt) v.push(`I12 ${sub.id} updatedAt < createdAt`);

      // I6/I7: audit trail is a valid, gap-free walk through the state machine ending at current status
      const transitions = audit.forSubscription(sub.id).filter((e) => e.action.startsWith('transition.'));
      let cursor = 'trialing';
      for (const t of transitions) {
        const event = t.action.replace('transition.', '') as LifecycleEvent;
        if (t.fromStatus !== cursor) v.push(`I6 ${sub.id} audit gap: expected from=${cursor}, got ${t.fromStatus}`);
        if (!SubscriptionStateMachine.canApply(t.fromStatus!, event) ||
            SubscriptionStateMachine.next(t.fromStatus!, event) !== t.toStatus) {
          v.push(`I6 ${sub.id} illegal audited transition ${t.fromStatus} -${event}-> ${t.toStatus}`);
        }
        cursor = t.toStatus!;
      }
      if (cursor !== sub.status) v.push(`I6 ${sub.id} audit ends at ${cursor} but row says ${sub.status}`);

      for (const inv of invoices.findBySubscription(sub.id)) {
        const ps = payments.findByInvoice(inv.id);
        const succeeded = ps.filter((p) => p.status === 'succeeded');
        // I5: pricing consistent between plan, invoice and payment
        if (inv.amount !== plan.priceCents) v.push(`I5 ${inv.id} amount ${inv.amount} != plan price ${plan.priceCents}`);
        ps.filter((p) => p.amount !== inv.amount).forEach((p) => v.push(`I5 ${p.id} amount != invoice amount`));
        // I2: never two successful payments for one invoice (no double charge)
        if (succeeded.length > 1) v.push(`I2 ${inv.id} has ${succeeded.length} succeeded payments`);
        // I3: paid/refunded <=> exactly one success, and paidAt set
        const settled = inv.status === 'paid' || inv.status === 'refunded';
        if (settled !== (succeeded.length === 1)) v.push(`I3 ${inv.id} status=${inv.status} with ${succeeded.length} successes`);
        if (settled !== (inv.paidAt !== null)) v.push(`I3 ${inv.id} status=${inv.status} paidAt=${inv.paidAt}`);
        // I4: failed invoice has a failed payment on record
        if (inv.status === 'failed' && !ps.some((p) => p.status === 'failed')) v.push(`I4 ${inv.id} failed without failed payment row`);
        // I10: at most one unresolved attempt
        if (ps.filter((p) => p.status === 'pending').length > 1) v.push(`I10 ${inv.id} has multiple pending attempts`);
        if (inv.attemptCount < ps.filter((p) => p.attempt !== null).length) v.push(`I10 ${inv.id} more attempt rows than attempts`);
      }
    }

    // I11: no event left half-processed
    for (const e of webhookEvents.all()) {
      if (e.outcome === 'processing') v.push(`I11 webhook ${e.eventId} stuck in processing`);
      if (e.deliveryCount < 1) v.push(`I11 webhook ${e.eventId} deliveryCount < 1`);
    }

    // I13: every provider call is a distinct genuine attempt
    if (this.provider) {
      const keys = this.provider.calls.map((c) => c.idempotencyKey);
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      if (dupes.length) v.push(`I13 provider charged the same attempt twice: ${dupes.join(',')}`);
    }
    return v;
  }

  assertHolds(): void {
    expect(this.violations()).toEqual([]);
  }
}
