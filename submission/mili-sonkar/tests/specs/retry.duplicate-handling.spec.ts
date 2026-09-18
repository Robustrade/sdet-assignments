import { afterEach, describe, expect, it } from 'vitest';
import { BillingTestFixture } from '../fixtures/BillingTestFixture.js';

describe('Retry and duplicate handling', () => {
    let fixture: BillingTestFixture;

    afterEach(() => {
        fixture?.close();
    });

    it('replays concurrent API idempotency requests without a second charge', async () => {
        fixture = new BillingTestFixture();
        const payload = { customerId: 'customer-idem-concurrent-001', plan: 'pro' as const };
        const options = { idempotencyKey: 'idem-concurrent-api-001' };

        const responses = await Promise.all([
            fixture.subscriptionClient.createSubscription(payload, options),
            fixture.subscriptionClient.createSubscription(payload, options),
        ]);

        expect(responses.map((response) => response.status)).toEqual([201, 201]);
        expect(responses[1].body).toEqual(responses[0].body);
        expect(fixture.paymentProviderMock.getChargeCount()).toBe(1);
        expect(fixture.subscriptionRepository.getByCustomerId(payload.customerId)).toHaveLength(1);
        expect(fixture.invoiceRepository.getBySubscriptionId(responses[0].body.subscription.id)).toHaveLength(1);
    });

    it('releases a failed API idempotency claim so a later request can retry', async () => {
        fixture = new BillingTestFixture();
        fixture.paymentProviderMock.setPaymentOutcome(false);

        const first = await fixture.subscriptionClient.createSubscription(
            { customerId: 'customer-provider-failure-001', plan: 'pro' },
            { idempotencyKey: 'idem-provider-failure-001' },
        );

        expect(first.status).toBe(500);
        expect(fixture.idempotencyKeyRepository.getByKey('idem-provider-failure-001')).toBeUndefined();
        expect(fixture.subscriptionRepository.getByCustomerId('customer-provider-failure-001')).toHaveLength(0);

        fixture.paymentProviderMock.setPaymentOutcome(true);
        const retry = await fixture.subscriptionClient.createSubscription(
            { customerId: 'customer-provider-failure-001', plan: 'pro' },
            { idempotencyKey: 'idem-provider-failure-001' },
        );

        expect(retry.status).toBe(201);
        expect(fixture.subscriptionRepository.getByCustomerId('customer-provider-failure-001')).toHaveLength(1);
    });
});
