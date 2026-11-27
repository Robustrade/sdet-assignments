import { PLANS, SEED } from '../framework/fixtures';
import { useHarness } from '../framework/useHarness';

/**
 * The invariant checker runs after every test in the suite. A green suite only means something
 * if the checker actually notices broken data - so here each kind of corruption is planted
 * directly in the database and the checker has to name it.
 */
describe('InvariantChecker detects corrupted state', () => {
  const env = useHarness({ checkInvariants: false });

  it('reports nothing for a healthy, busy database', async () => {
    await env().given.trialing();
    await env().given.active();
    await env().given.canceledByExhaustedRetries();
    await env().given.signupChargeOutcomeUnknown();
    expect(env().invariants.violations()).toEqual([]);
  });

  const corruptions: Array<{ name: string; rule: string; arrange: 'active' | 'pastDue' | 'canceled'; sql: string[] }> = [
    {
      name: 'active subscription whose only payment is declined',
      rule: 'INV-1',
      arrange: 'active',
      sql: ["UPDATE charge_attempts SET status = 'declined'"],
    },
    {
      name: 'canceled subscription that still has an open invoice',
      rule: 'INV-2',
      arrange: 'pastDue',
      sql: ["UPDATE subscriptions SET status = 'canceled', canceled_at = '2026-01-01T09:00:00.000Z'"],
    },
    {
      name: 'invoice amount drifted from the plan price',
      rule: 'INV-5',
      arrange: 'active',
      sql: ['UPDATE invoices SET amount_cents = 100'],
    },
    {
      name: 'invoice marked paid twice (two successful attempts)',
      rule: 'INV-6',
      arrange: 'active',
      sql: [
        `INSERT INTO charge_attempts (id, invoice_id, attempt_no, idempotency_key, amount_cents, status, created_at)
         SELECT 'att_extra', invoice_id, 2, 'extra-key', amount_cents, 'succeeded', created_at FROM charge_attempts LIMIT 1`,
      ],
    },
    {
      name: 'audit entry edited after the fact',
      rule: 'INV-7',
      arrange: 'active',
      sql: ["UPDATE audit_log SET source = 'webhook' WHERE seq = 1"],
    },
  ];

  it.each(corruptions)('$rule: $name', async ({ rule, arrange, sql }) => {
    if (arrange === 'active') await env().given.active();
    if (arrange === 'pastDue') await env().given.pastDue();
    if (arrange === 'canceled') await env().given.canceled();
    expect(env().invariants.violations()).toEqual([]);

    env().db.run('PRAGMA foreign_keys = OFF');
    sql.forEach((statement) => env().db.run(statement));

    expect(env().invariants.violations()).toEqual(expect.arrayContaining([expect.stringContaining(rule)]));
  });

  it('INV-11: an audited transition that is not in the lifecycle diagram (canceled -> active)', async () => {
    const { subscriptionId } = await env().given.canceled();
    env().db.run("UPDATE subscriptions SET status = 'active', canceled_at = NULL");
    env().repos.audit.append({ subscriptionId, action: 'status_changed', fromStatus: 'canceled', toStatus: 'active', source: 'webhook', at: env().clock.now() });
    expect(env().invariants.violations()).toEqual(expect.arrayContaining([expect.stringContaining('INV-11')]));
  });

  it('INV-10: an attempt stuck in pending', async () => {
    const { invoiceId } = await env().given.pastDue();
    env().db.run("UPDATE charge_attempts SET status = 'pending', settled_at = NULL WHERE invoice_id = ?", [invoiceId]);
    expect(env().invariants.violations()).toEqual(expect.arrayContaining([expect.stringContaining('INV-10')]));
  });

  it('INV-9: money taken on a void invoice without a refund flag', async () => {
    const { invoiceId } = await env().given.active();
    env().db.run("UPDATE invoices SET status = 'void', paid_at = NULL WHERE id = ?", [invoiceId]);
    expect(env().invariants.violations()).toEqual(expect.arrayContaining([expect.stringContaining('INV-9')]));
  });

  it('INV-8: provider charged a key with no persisted attempt (charge made outside the books)', async () => {
    const { invoiceId } = await env().given.active();
    await env().gateway.charge({
      customerId: SEED.alice.customerId,
      paymentMethodId: SEED.alice.card,
      amountCents: PLANS.pro.priceCents,
      currency: 'USD',
      idempotencyKey: 'charge-made-outside-the-service',
      invoiceId,
    });
    expect(env().invariants.violations()).toEqual([expect.stringContaining('INV-8')]);
  });
});
