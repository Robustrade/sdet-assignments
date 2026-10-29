import type { InvoiceStatus } from '../../../src/domain/Invoice';
import type { SubscriptionStatus } from '../../../src/domain/Subscription';
import { TestEnvironment } from '../../framework/env/TestEnvironment';
import { BillingAssertions } from '../../framework/assertions/BillingAssertions';
import { aWebhookEvent } from '../../framework/builders/WebhookEventBuilder';

/**
 * The provider redelivers events. The same `event_id` must change state, invoices, audit and
 * provider calls exactly once; a redelivery only increments `delivery_count`.
 */
describe('POST /webhooks/payment-provider - duplicate delivery (idempotency)', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = TestEnvironment.create();
  });

  /** One scenario per event type; each begins in a state where the first delivery does real work. */
  const scenarios: Array<{
    name: string;
    status: SubscriptionStatus;
    invoices: InvoiceStatus[];
    event: () => Record<string, unknown>;
    transitions: number;
  }> = [
    {
      name: 'payment.succeeded (trialing -> active)',
      status: 'trialing',
      invoices: ['pending'],
      event: () => aWebhookEvent().succeeded().withId('evt_dup').build(),
      transitions: 1,
    },
    {
      name: 'payment.failed (trialing -> past_due)',
      status: 'trialing',
      invoices: ['pending'],
      event: () => aWebhookEvent().failed().withId('evt_dup').build(),
      transitions: 1,
    },
    {
      name: 'payment.failed (third failure, past_due -> canceled)',
      status: 'past_due',
      invoices: ['failed', 'failed', 'pending'],
      event: () => aWebhookEvent().failed().withId('evt_dup').forInvoice('inv_seed_003').build(),
      transitions: 1,
    },
    {
      name: 'payment.refunded (invoice refunded)',
      status: 'active',
      invoices: ['paid'],
      event: () => aWebhookEvent().refunded().withId('evt_dup').build(),
      transitions: 0,
    },
  ];

  describe.each(scenarios)('$name', ({ status, invoices, event, transitions }) => {
    beforeEach(async () => {
      await env.seedBilling(status, invoices);
    });

    it('the first delivery is processed and the redelivery is answered as a duplicate', async () => {
      const first = await env.webhooks.deliver(event());
      const second = await env.webhooks.deliver(event());

      BillingAssertions.expectWebhookAck(first, 'processed');
      BillingAssertions.expectWebhookAck(second, 'duplicate');
    });

    it('the redelivery changes no subscription, invoice or audit row', async () => {
      await env.webhooks.deliver(event());
      const afterFirst = await env.persistence.snapshot();

      await env.webhooks.deliver(event());
      const afterSecond = await env.persistence.snapshot();

      expect(afterSecond.subscriptions).toEqual(afterFirst.subscriptions);
      expect(afterSecond.invoices).toEqual(afterFirst.invoices);
      expect(afterSecond.auditLog).toEqual(afterFirst.auditLog);
      expect(afterSecond.auditLog).toHaveLength(transitions);
    });

    it('stores one event row whose only change is delivery_count (and last delivery time)', async () => {
      await env.webhooks.deliver(event());
      const [afterFirst] = (await env.persistence.snapshot()).webhookEvents;
      env.clock.advanceDays(1);

      await env.webhooks.deliver(event());

      const { webhookEvents } = await env.persistence.snapshot();
      expect(webhookEvents).toHaveLength(1);
      expect(webhookEvents[0]).toEqual({
        ...afterFirst,
        deliveryCount: 2,
        lastDeliveredAt: env.clock.now().toISOString(),
      });
    });

    it('never calls the payment provider', async () => {
      await env.webhooks.deliver(event());
      await env.webhooks.deliver(event());

      env.providerCalls.expectNoCharges();
    });

    it('delivered ten times in a row: still one effect and delivery_count 10', async () => {
      await env.webhooks.deliver(event());
      const afterFirst = await env.persistence.snapshot();

      for (let i = 0; i < 9; i += 1) {
        BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event()), 'duplicate');
      }

      const afterTen = await env.persistence.snapshot();
      expect(afterTen.subscriptions).toEqual(afterFirst.subscriptions);
      expect(afterTen.invoices).toEqual(afterFirst.invoices);
      expect(afterTen.auditLog).toEqual(afterFirst.auditLog);
      await env.persistence.expectWebhookEvent('evt_dup', { deliveryCount: 10 });
    });
  });

  it('a redelivered event that was ignored the first time stays ignored (and counts as a duplicate)', async () => {
    await env.seedBilling('active', ['paid']);
    const event = () => aWebhookEvent().succeeded().withId('evt_dup').build(); // invoice already paid

    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event()), 'ignored');
    BillingAssertions.expectWebhookAck(await env.webhooks.deliver(event()), 'duplicate');

    await env.persistence.expectWebhookEvent('evt_dup', {
      outcome: 'ignored',
      reason: 'invoice_already_paid',
      deliveryCount: 2,
    });
  });

  it('the event id is the identity: a redelivery with different content is still a duplicate and changes nothing', async () => {
    await env.seedBilling('trialing', ['pending']);
    await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_dup').build());
    const afterFirst = await env.persistence.snapshot();

    const res = await env.webhooks.deliver(aWebhookEvent().failed().withId('evt_dup').build());

    BillingAssertions.expectWebhookAck(res, 'duplicate');
    const afterSecond = await env.persistence.snapshot();
    expect(afterSecond.subscriptions).toEqual(afterFirst.subscriptions);
    expect(afterSecond.invoices).toEqual(afterFirst.invoices);
    await env.persistence.expectWebhookEvent('evt_dup', { type: 'payment.succeeded', deliveryCount: 2 });
  });

  it('different event ids for the same invoice and type are separate events: the second is ignored, not applied again', async () => {
    await env.seedBilling('trialing', ['pending']);

    const first = await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_a').build());
    const second = await env.webhooks.deliver(aWebhookEvent().succeeded().withId('evt_b').build());

    BillingAssertions.expectWebhookAck(first, 'processed');
    BillingAssertions.expectWebhookAck(second, 'ignored');
    await env.persistence.expectWebhookEventCount(2);
    await env.persistence.expectWebhookEvent('evt_a', { outcome: 'processed', deliveryCount: 1 });
    await env.persistence.expectWebhookEvent('evt_b', { outcome: 'ignored', reason: 'invoice_already_paid', deliveryCount: 1 });
    await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid']);
    await env.persistence.expectAuditTrail('sub_seed_001', [
      { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'webhook', eventId: 'evt_a' },
    ]);
  });

  it('five identical deliveries arriving at the same time (slow storage): exactly one is processed, the rest are duplicates', async () => {
    // Slow storage opens the read-then-write gap in which unserialized duplicates would all pass the "seen it?" check.
    env = TestEnvironment.create({ slowStorage: true });
    await env.seedBilling('trialing', ['pending']);
    const body = aWebhookEvent().succeeded().withId('evt_race').build();

    const results = await Promise.all(Array.from({ length: 5 }, () => env.webhooks.deliver(body)));

    const outcomes = results.map((res) => res.body.status).sort();
    expect(outcomes).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate', 'processed']);
    await env.persistence.expectWebhookEvent('evt_race', { outcome: 'processed', deliveryCount: 5 });
    await env.persistence.expectInvoiceStatuses('sub_seed_001', ['paid']);
    await env.persistence.expectAuditTrail('sub_seed_001', [
      { from: 'trialing', to: 'active', trigger: 'charge_succeeded', source: 'webhook', eventId: 'evt_race' },
    ]);
  });
});
