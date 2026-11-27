import { InvoiceLifecycle } from '../../src/domain/invoiceLifecycle';
import { ApprovedTransition, SubscriptionLifecycle } from '../../src/domain/lifecycle';
import { BasicPlan, ProPlan } from '../../src/domain/plans';
import { SubscriptionRepository } from '../../src/persistence/repositories';
import { SqlDatabase } from '../../src/persistence/SqlDatabase';

/** Fast, pure checks on the rules the service is built on. HTTP-level proof lives in tests/lifecycle. */
describe('Domain rules', () => {
  it('lifecycle table: exactly the 7 spec transitions, 2 legal "stay" events, everything else rejected', () => {
    const outcomes = Object.fromEntries(SubscriptionLifecycle.table().map((row) => [`${row.from} + ${row.trigger}`, row.to ?? row.outcome]));

    expect(outcomes).toEqual({
      'trialing + payment_succeeded': 'active',
      'trialing + payment_failed': 'past_due',
      'trialing + cancel_requested': 'canceled',
      'trialing + retries_exhausted': 'reject',
      'active + payment_succeeded': 'stay',
      'active + payment_failed': 'past_due',
      'active + cancel_requested': 'canceled',
      'active + retries_exhausted': 'reject',
      'past_due + payment_succeeded': 'active',
      'past_due + payment_failed': 'stay',
      'past_due + cancel_requested': 'reject',
      'past_due + retries_exhausted': 'canceled',
      'canceled + payment_succeeded': 'reject',
      'canceled + payment_failed': 'reject',
      'canceled + cancel_requested': 'reject',
      'canceled + retries_exhausted': 'reject',
    });
  });

  it('a hand-built transition object is refused by the repository (status cannot be set around the lifecycle)', async () => {
    const db = await SqlDatabase.open();
    const forged: ApprovedTransition = { subscriptionId: 'sub_x', from: 'canceled', to: 'active', trigger: 'payment_succeeded' };

    const applyForged = () => new SubscriptionRepository(db).applyTransition(forged, '2026-01-01T00:00:00.000Z');

    expect(applyForged).toThrow(/must come from SubscriptionLifecycle/);
    db.close();
  });

  it('invoice lifecycle: a paid invoice can only be refunded, never failed, voided or paid again', () => {
    expect(InvoiceLifecycle.next('paid', 'collection_failed')).toBeNull();
    expect(InvoiceLifecycle.next('paid', 'voided')).toBeNull();
    expect(InvoiceLifecycle.next('paid', 'paid')).toBeNull();
    expect(InvoiceLifecycle.next('paid', 'refunded')).toBe('refunded');
  });

  it('plan strategies: price, trial, retry budget and back-off per plan', () => {
    const start = '2026-01-01T00:00:00.000Z';
    const basic = new BasicPlan();
    const pro = new ProPlan();

    expect([basic.priceCents, basic.trialDays, basic.maxAttempts]).toEqual([1900, 14, 3]);
    expect([pro.priceCents, pro.trialDays, pro.maxAttempts]).toEqual([4900, 0, 4]);
    expect([1, 2, 3].map((failed) => basic.nextRetryAt(failed, start))).toEqual([
      '2026-01-04T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
      null,
    ]);
    expect([1, 2, 3, 4].map((failed) => pro.nextRetryAt(failed, start))).toEqual([
      '2026-01-02T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
      '2026-01-06T00:00:00.000Z',
      null,
    ]);
  });
});
