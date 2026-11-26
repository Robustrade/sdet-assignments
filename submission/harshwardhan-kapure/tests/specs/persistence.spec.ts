import { beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../support/TestContext';
import {
  expectApiMatchesDb,
  expectAuditTrail,
  expectNeverActiveWithoutPaidInvoice,
  expectNoDuplicateInvoices
} from '../support/assertions';

describe('Database Persistence & Auditability', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = TestContext.create();
  });

  it('maintains API-DB parity, invoice accuracy, and audit trail across every lifecycle stage', async () => {
    const customer = ctx.seedCustomer();

    // Stage 1: Created in trialing (pro)
    const sub = await ctx.createSubscriptionViaApi(customer, 'pro');
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    expect(ctx.repo.findInvoicesBySubscriptionId(sub.id)).toHaveLength(0);
    expectAuditTrail(ctx.repo, sub.id, [{ from: null, to: 'trialing' }]);

    // Stage 2: Trial fails -> past_due
    ctx.provider.respondWithDecline();
    await ctx.api.billSubscription(sub.id);
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    expectNeverActiveWithoutPaidInvoice(ctx.repo, sub.id);
    expect(ctx.repo.findInvoicesBySubscriptionId(sub.id).map((i) => i.status)).toEqual(['failed']);
    expectAuditTrail(ctx.repo, sub.id, [
      { from: null, to: 'trialing' },
      { from: 'trialing', to: 'past_due' }
    ]);

    // Stage 3: Retry succeeds -> active
    ctx.provider.respondWithSuccess();
    await ctx.api.billSubscription(sub.id);
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    expectNeverActiveWithoutPaidInvoice(ctx.repo, sub.id);
    expectNoDuplicateInvoices(ctx.repo, sub.id, 2);
    expect(ctx.repo.findInvoicesBySubscriptionId(sub.id).map((i) => i.status)).toEqual(['failed', 'paid']);
    expectAuditTrail(ctx.repo, sub.id, [
      { from: null, to: 'trialing' },
      { from: 'trialing', to: 'past_due' },
      { from: 'past_due', to: 'active' }
    ]);

    // Stage 4: Canceled via API
    await ctx.api.cancelSubscription(sub.id);
    await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    expectAuditTrail(ctx.repo, sub.id, [
      { from: null, to: 'trialing' },
      { from: 'trialing', to: 'past_due' },
      { from: 'past_due', to: 'active' },
      { from: 'active', to: 'canceled' }
    ]);
  });

  it('applies consistent plan pricing between creation and billing with coherent timestamps', async () => {
    const customer = ctx.seedCustomer();
    ctx.provider.respondWithSuccess();

    const basicSub = await ctx.createSubscriptionViaApi(customer, 'basic');
    const basicInvoices = ctx.repo.findInvoicesBySubscriptionId(basicSub.id);
    expect(basicInvoices).toHaveLength(1);
    expect(basicInvoices[0].amount).toBe(1900);
    expect(basicInvoices[0].currency).toBe('USD');
    expect(Date.parse(basicSub.created_at)).not.toBeNaN();
    expect(Date.parse(basicInvoices[0].created_at)).toBeGreaterThanOrEqual(Date.parse(basicSub.created_at));
  });

  it('isolates state completely between TestContext instances', () => {
    expect(ctx.repo.listSubscriptions()).toHaveLength(0);
    expect(ctx.repo.listInvoices()).toHaveLength(0);
    expect(ctx.repo.listWebhookEvents()).toHaveLength(0);
    expect(ctx.repo.listAuditLogs()).toHaveLength(0);
  });
});
