import { afterEach, describe, expect, it } from 'vitest';
import { BillingTestFixture } from '../fixtures/BillingTestFixture.js';
import { WebhookEventBuilder } from '../builders/WebhookEventBuilder.js';

 describe('Billing lifecycle', () => {
    let fixture: BillingTestFixture;

    afterEach(() => {
        fixture?.close();
    });

    it('keeps API, persistence, invoices, and audit history aligned', async () => {
        fixture = new BillingTestFixture();
        const created = await fixture.subscriptionClient.createSubscription(
            { customerId: 'customer-lifecycle-001', plan: 'basic' },
            { idempotencyKey: 'idem-lifecycle-001', correlationId: 'corr-create-001' },
        );

        expect(created.status).toBe(201);
        const subscription = created.body.subscription;
        const persisted = fixture.subscriptionRepository.getById(subscription.id);

        expect(persisted).toBeDefined();
        expect(fixture.persistenceValidator.validate(subscription, persisted!).mismatches).toEqual([]);

        const event = new WebhookEventBuilder()
            .forSubscription(subscription.id)
            .withEventId('evt-lifecycle-success')
            .build();
        const webhook = await fixture.webhookClient.send(event, 'corr-webhook-001');

        expect(webhook.status).toBe(200);
        expect(webhook.body.status).toBe('active');
        expect(fixture.invoiceRepository.getBySubscriptionId(subscription.id)).toHaveLength(1);
        expect(fixture.auditRepository.countBySubscriptionId(subscription.id)).toBe(2);

        const fetched = await fixture.subscriptionClient.getSubscription(subscription.id);
        expect(fetched.status).toBe(200);
        expect(fetched.body.status).toBe('active');

        const canceled = await fixture.subscriptionClient.cancelSubscription(subscription.id, 'corr-cancel-001');
        expect(canceled.status).toBe(200);
        expect(canceled.body.status).toBe('canceled');
        expect(fixture.subscriptionRepository.getById(subscription.id)?.status).toBe('canceled');
    });

    it('applies one business effect for concurrent duplicate webhooks', async () => {
        fixture = new BillingTestFixture();
        const created = await fixture.subscriptionClient.createSubscription(
            { customerId: 'customer-concurrent-001', plan: 'basic' },
            { idempotencyKey: 'idem-concurrent-001' },
        );
        const event = new WebhookEventBuilder()
            .forSubscription(created.body.subscription.id)
            .withEventId('evt-concurrent-001')
            .build();

        const responses = await Promise.all([
            fixture.webhookClient.send(event),
            fixture.webhookClient.send(event),
        ]);

        expect(responses.map((response) => response.status)).toEqual([200, 200]);
        expect(responses.filter((response) => response.body.duplicate === false)).toHaveLength(1);
        expect(responses.filter((response) => response.body.duplicate === true)).toHaveLength(1);
        expect(fixture.invoiceRepository.getBySubscriptionId(created.body.subscription.id)).toHaveLength(1);
        expect(fixture.auditRepository.countBySubscriptionId(created.body.subscription.id)).toBe(2);
    });

    it('audits rejected transitions without changing subscription state', async () => {
        fixture = new BillingTestFixture();
        const created = await fixture.subscriptionClient.createSubscription(
            { customerId: 'customer-rejected-001', plan: 'basic' },
            { idempotencyKey: 'idem-rejected-001' },
        );

        const firstCancellation = await fixture.subscriptionClient.cancelSubscription(
            created.body.subscription.id,
            'corr-cancel-first',
        );
        expect(firstCancellation.status).toBe(200);

        const rejectedCancellation = await fixture.subscriptionClient.cancelSubscription(
            created.body.subscription.id,
            'corr-cancel-rejected',
        );
        expect(rejectedCancellation.status).toBe(409);
        expect(fixture.subscriptionRepository.getById(created.body.subscription.id)?.status).toBe('canceled');

        const audit = fixture.auditRepository.getLatestBySubscriptionId(
            created.body.subscription.id,
        );
        expect(audit).toMatchObject({
            oldState: 'canceled',
            newState: 'canceled',
            eventType: 'subscription.cancel_rejected',
            correlationId: 'corr-cancel-rejected',
        });
    });
});
