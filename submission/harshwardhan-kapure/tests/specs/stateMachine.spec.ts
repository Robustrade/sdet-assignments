import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  SubscriptionStateMachine
} from '../../src/stateMachine';
import { SubscriptionRecord, SubscriptionStatus, SubscriptionTrigger } from '../../src/types';
import { TestContext } from '../support/TestContext';
import { aWebhook } from '../support/builders';
import { expectApiMatchesDb, expectNeverActiveWithoutPaidInvoice } from '../support/assertions';

describe('State-Machine Lifecycle & Invariants', () => {
  const stateMachine = new SubscriptionStateMachine();
  let ctx: TestContext;

  beforeEach(() => {
    ctx = TestContext.create();
  });

  describe('Transition table (all 7 legal transitions)', () => {
    const validCases: Array<{
      from: SubscriptionStatus;
      trigger: SubscriptionTrigger;
      to: SubscriptionStatus;
      label: string;
    }> = [
      { from: 'trialing', trigger: 'TRIAL_SUCCEEDED', to: 'active', label: 'trialing -> active (first charge succeeds)' },
      { from: 'trialing', trigger: 'TRIAL_FAILED', to: 'past_due', label: 'trialing -> past_due (first charge fails)' },
      { from: 'active', trigger: 'RECURRING_FAILED', to: 'past_due', label: 'active -> past_due (recurring charge fails)' },
      { from: 'past_due', trigger: 'RETRY_SUCCEEDED', to: 'active', label: 'past_due -> active (retry charge succeeds)' },
      { from: 'past_due', trigger: 'RETRIES_EXHAUSTED', to: 'canceled', label: 'past_due -> canceled (retries exhausted)' },
      { from: 'active', trigger: 'CANCEL', to: 'canceled', label: 'active -> canceled (API cancel)' },
      { from: 'trialing', trigger: 'CANCEL', to: 'canceled', label: 'trialing -> canceled (API cancel)' }
    ];

    it('contains exactly the 7 transitions defined in the specification', () => {
      expect(ALLOWED_TRANSITIONS).toHaveLength(7);
    });

    it.each(validCases)('executes $label via real lifecycle setup and transitions', async ({ from, trigger, to }) => {
      // 1. Direct state-machine check
      expect(stateMachine.canTransition(from, trigger)).toBe(true);
      expect(stateMachine.transition(from, trigger)).toBe(to);

      // 2. Reach starting state via real API/billing actions (never teleporting DB state)
      const customer = ctx.seedCustomer();
      let sub: SubscriptionRecord;
      if (from === 'trialing') {
        sub = await ctx.createSubscriptionViaApi(customer, 'pro');
      } else if (from === 'active') {
        sub = await ctx.givenActiveSubscription(customer, 'pro');
      } else {
        const attempts = trigger === 'RETRIES_EXHAUSTED' ? 2 : 1;
        sub = await ctx.givenPastDueSubscription(customer, attempts);
      }

      if (trigger === 'TRIAL_SUCCEEDED' || trigger === 'RETRY_SUCCEEDED') {
        ctx.provider.respondWithSuccess();
        const res = await ctx.api.billSubscription(sub.id);
        expect(res.status).toBe(200);
        expect(res.body.subscription.status).toBe(to);
      } else if (trigger === 'TRIAL_FAILED' || trigger === 'RECURRING_FAILED' || trigger === 'RETRIES_EXHAUSTED') {
        ctx.provider.respondWithDecline();
        const res = await ctx.api.billSubscription(sub.id);
        expect(res.status).toBe(200);
        expect(res.body.subscription.status).toBe(to);
      } else if (trigger === 'CANCEL') {
        const res = await ctx.api.cancelSubscription(sub.id);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(to);
      }

      await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
      expectNeverActiveWithoutPaidInvoice(ctx.repo, sub.id);
    });

    it('supports webhook-driven active -> past_due and past_due -> active transitions', async () => {
      const customer = ctx.seedCustomer();
      const sub = await ctx.givenActiveSubscription(customer, 'pro');

      const failWh = await ctx.api.sendWebhook(
        aWebhook().paymentFailed().forSubscription(sub.id).withAmount(4900).signed()
      );
      expect(failWh.body.status).toBe('processed');
      expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('past_due');
      await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);

      const recoverWh = await ctx.api.sendWebhook(
        aWebhook().paymentSucceeded().forSubscription(sub.id).withAmount(4900).signed()
      );
      expect(recoverWh.body.status).toBe('processed');
      expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('active');
      await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    });
  });

  describe('Invalid transitions are structurally impossible', () => {
    it.each<{ from: SubscriptionStatus; trigger: SubscriptionTrigger }>([
      { from: 'canceled', trigger: 'TRIAL_SUCCEEDED' },
      { from: 'canceled', trigger: 'RETRY_SUCCEEDED' },
      { from: 'canceled', trigger: 'CANCEL' },
      { from: 'past_due', trigger: 'CANCEL' },
      { from: 'active', trigger: 'RETRIES_EXHAUSTED' }
    ])('rejects invalid state machine transition $from + $trigger', ({ from, trigger }) => {
      expect(stateMachine.canTransition(from, trigger)).toBe(false);
      expect(() => stateMachine.transition(from, trigger)).toThrow(InvalidTransitionError);
    });

    it('rejects POST /subscriptions/:id/cancel with 409 when subscription is past_due', async () => {
      const customer = ctx.seedCustomer();
      const sub = await ctx.givenPastDueSubscription(customer, 1);

      const res = await ctx.api.cancelSubscription(sub.id);
      expect(res.status).toBe(409);
      expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('past_due');
      await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    });

    it('never reactivates a canceled subscription when a stray payment.succeeded webhook arrives', async () => {
      const customer = ctx.seedCustomer();
      const sub = await ctx.createSubscriptionViaApi(customer, 'pro');
      await ctx.api.cancelSubscription(sub.id);

      const whRes = await ctx.api.sendWebhook(
        aWebhook().paymentSucceeded().forSubscription(sub.id).withAmount(4900).signed()
      );

      expect(whRes.status).toBe(200);
      expect(whRes.body.status).toBe('ignored');
      expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('canceled');
      expect(ctx.repo.findInvoicesBySubscriptionId(sub.id)).toHaveLength(0);
      await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    });

    it('does not regress active subscription when out-of-order payment.failed arrives after payment.succeeded for the same invoice', async () => {
      const customer = ctx.seedCustomer();
      const sub = await ctx.createSubscriptionViaApi(customer, 'pro');

      const successRes = await ctx.api.sendWebhook(
        aWebhook()
          .withEventId('evt_success_first')
          .paymentSucceeded()
          .forSubscription(sub.id)
          .forInvoice('inv_shared_001')
          .withAmount(4900)
          .signed()
      );
      expect(successRes.status).toBe(200);
      expect(successRes.body.status).toBe('processed');
      expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('active');

      const staleFailRes = await ctx.api.sendWebhook(
        aWebhook()
          .withEventId('evt_stale_fail')
          .paymentFailed()
          .forSubscription(sub.id)
          .forInvoice('inv_shared_001')
          .withAmount(4900)
          .signed()
      );

      expect(staleFailRes.status).toBe(200);
      expect(staleFailRes.body.status).toBe('ignored');
      expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('active');
      expect(ctx.repo.findInvoiceById('inv_shared_001')!.status).toBe('paid');
      await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    });

    it('does not regress active subscription when stale payment.failed webhook targets an invoice already paid via billing run', async () => {
      const customer = ctx.seedCustomer();
      const sub = await ctx.givenActiveSubscription(customer, 'pro');
      const [paidInvoice] = ctx.repo.findInvoicesBySubscriptionId(sub.id);

      const staleFailRes = await ctx.api.sendWebhook(
        aWebhook()
          .paymentFailed()
          .forSubscription(sub.id)
          .forInvoice(paidInvoice.id)
          .withAmount(4900)
          .signed()
      );

      expect(staleFailRes.status).toBe(200);
      expect(staleFailRes.body.status).toBe('ignored');
      expect(ctx.repo.findSubscriptionById(sub.id)!.status).toBe('active');
      expect(ctx.repo.findInvoiceById(paidInvoice.id)!.status).toBe('paid');
      await expectApiMatchesDb(ctx.api, ctx.repo, sub.id);
    });
  });
});
