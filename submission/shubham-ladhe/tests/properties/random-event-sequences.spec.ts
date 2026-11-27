import fc from 'fast-check';
import { SubscriptionStatus } from '../../src/domain/types';
import { aSignupRequest, WebhookPayload } from '../framework/builders';
import { TestHarness } from '../framework/TestHarness';

/**
 * Property-based check of the whole service. fast-check generates random sequences of what the
 * real world throws at a billing system - signups, cancels, time passing, provider declines and
 * timeouts, fresh webhooks, redelivered webhooks and stale ones - and after EVERY step we check:
 *
 *   P1  all cross-table invariants hold (InvariantChecker, incl. legal transitions only)
 *   P2  a canceled subscription stays canceled forever
 *   P3  redelivering an already-seen event changes nothing in the database
 *   P4  the API shows exactly what is stored, for every subscription
 *   P5  the provider never captures money twice for the same invoice
 *
 * On failure fast-check shrinks to the shortest failing sequence and prints its seed.
 */

type ProviderOutcome = 'succeed' | 'decline' | 'timeout' | 'timeout_captured';
type Action =
  | { kind: 'signup'; plan: 'basic' | 'pro'; outcome: ProviderOutcome }
  | { kind: 'cancel'; pick: number }
  | { kind: 'time_passes'; days: number; outcomes: ProviderOutcome[] }
  | { kind: 'webhook'; pick: number; type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded'; target: 'latest' | 'oldest'; withCharge: boolean }
  | { kind: 'redeliver'; pick: number };

const providerOutcome = fc.constantFrom<ProviderOutcome>('succeed', 'succeed', 'decline', 'decline', 'timeout', 'timeout_captured');

const anAction: fc.Arbitrary<Action> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('signup' as const), plan: fc.constantFrom('basic' as const, 'pro' as const), outcome: providerOutcome }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('cancel' as const), pick: fc.nat() }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('time_passes' as const),
      days: fc.integer({ min: 1, max: 20 }),
      outcomes: fc.array(providerOutcome, { maxLength: 4 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('webhook' as const),
      pick: fc.nat(),
      type: fc.constantFrom('payment.succeeded' as const, 'payment.failed' as const, 'payment.refunded' as const),
      target: fc.constantFrom('latest' as const, 'oldest' as const),
      withCharge: fc.boolean(),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('redeliver' as const), pick: fc.nat() }) },
);

function scriptProviderOutcome(env: TestHarness, outcome: ProviderOutcome): void {
  if (outcome === 'succeed') env.gateway.willSucceed();
  if (outcome === 'decline') env.gateway.willDecline('card_declined');
  if (outcome === 'timeout') env.gateway.willTimeout();
  if (outcome === 'timeout_captured') env.gateway.willTimeout({ captured: true });
}

async function applyAction(env: TestHarness, action: Action, delivered: WebhookPayload[]): Promise<void> {
  const subscriptions = env.repos.subscriptions.findAll();
  const pickSubscription = (n: number) => subscriptions[n % Math.max(subscriptions.length, 1)];

  switch (action.kind) {
    case 'signup': {
      scriptProviderOutcome(env, action.outcome);
      await env.api.createOk(aSignupRequest().onPlan(action.plan).build());
      return;
    }
    case 'cancel': {
      const subscription = pickSubscription(action.pick);
      if (subscription) await env.api.cancel(subscription.id); // may legitimately be 409
      return;
    }
    case 'time_passes': {
      action.outcomes.forEach((outcome) => scriptProviderOutcome(env, outcome));
      await env.advanceDaysAndBill(action.days);
      return;
    }
    case 'webhook': {
      const subscription = pickSubscription(action.pick);
      if (!subscription) return;
      const invoices = env.repos.invoices.findBySubscription(subscription.id);
      const invoice = action.target === 'latest' ? invoices.at(-1) : invoices[0];
      if (!invoice) return;
      const event = env.webhooks.about(invoice.id);

      // Behave like a real provider: an event about a charge WE sent (still unresolved on our side)
      // reports what the provider actually did with it. Arbitrary outcomes are only generated for
      // provider-side charges (fresh charge ids), e.g. the provider's own retries.
      const unresolvedAttempt = env.repos.attempts.findByInvoice(invoice.id).find((attempt) => attempt.status === 'unknown');
      if (unresolvedAttempt && action.type !== 'payment.refunded') {
        const whatProviderDid = env.gateway.resultFor(unresolvedAttempt.idempotencyKey);
        if (!whatProviderDid) return; // the provider never received it, so it has nothing to report
        if (whatProviderDid.outcome === 'succeeded') event.paymentSucceeded();
        else event.paymentFailed(whatProviderDid.reason);
        event.withChargeId(whatProviderDid.providerChargeId);
      } else {
        event.ofType(action.type);
        if (action.withCharge || action.type !== 'payment.refunded') event.withChargeId(`ch_ext_${delivered.length + 1}`);
      }
      const payload = event.build();
      await env.webhooks.send(payload);
      delivered.push(payload);
      return;
    }
    case 'redeliver': {
      if (delivered.length === 0) return;
      const alreadyDelivered = delivered[action.pick % delivered.length]!;
      const dbBefore = env.snapshot();
      const redelivery = await env.webhooks.send(alreadyDelivered);
      // P3: a redelivered event changes nothing
      expect(redelivery.body).toMatchObject({ outcome: 'duplicate' });
      expect(env.tablesChangedSince(dbBefore)).toEqual([]);
      return;
    }
  }
}

/** P1, P2, P4, P5 - checked after every step. (P3 is checked inside the redeliver action.) */
async function expectSystemConsistent(env: TestHarness, everCanceled: Set<string>): Promise<void> {
  // P1: all cross-table invariants
  expect(env.invariants.violations()).toEqual([]);

  for (const subscription of env.repos.subscriptions.findAll()) {
    // P2: once canceled, always canceled
    if (everCanceled.has(subscription.id)) expect(subscription.status).toBe<SubscriptionStatus>('canceled');
    if (subscription.status === 'canceled') everCanceled.add(subscription.id);
    // P4: the API shows exactly what is stored
    expect(await env.apiVsDbDifferences(subscription.id)).toEqual([]);
  }

  // P5: money is never captured twice for the same invoice
  const capturesPerInvoice = new Map<string, number>();
  for (const capture of env.gateway.capturedCharges()) {
    const invoiceId = env.gateway.calls.find((call) => call.idempotencyKey === capture.idempotencyKey)!.invoiceId;
    capturesPerInvoice.set(invoiceId, (capturesPerInvoice.get(invoiceId) ?? 0) + 1);
  }
  for (const [invoiceId, captures] of capturesPerInvoice) expect({ invoiceId, captures }).toEqual({ invoiceId, captures: 1 });
}

describe('Property: random event sequences keep the system consistent', () => {
  it('holds P1-P5 after every step', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(anAction, { minLength: 1, maxLength: 25 }), async (actions) => {
        const env = await TestHarness.create();
        const delivered: WebhookPayload[] = [];
        const everCanceled = new Set<string>();
        try {
          for (const action of actions) {
            await applyAction(env, action, delivered);
            await expectSystemConsistent(env, everCanceled);
          }
        } finally {
          await env.close();
        }
      }),
      { numRuns: Number(process.env.PROPERTY_RUNS ?? 75) },
    );
  }, 120_000);
});
