
import { createDatabase } from '../../src/utils/database';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { SubscriptionStateMachine } from '../../src/state-machine/SubscriptionStateMachine';
import { MockPaymentProvider } from '../../src/providers/PaymentProvider';
import { SubscriptionService } from '../../src/services/SubscriptionService';

describe('SubscriptionService', () => {
    let db: ReturnType<typeof createDatabase>;
    let service: SubscriptionService;
    let paymentProvider: MockPaymentProvider;

    beforeEach(() => {
        db = createDatabase();

        const repository = new SubscriptionRepository(db);
        const stateMachine = new SubscriptionStateMachine();
        paymentProvider = new MockPaymentProvider();

        service = new SubscriptionService(
            repository,
            stateMachine,
            paymentProvider
        );
    });

    afterEach(() => {
        db.close();
    });

    const input = {
        customerId: 'customer-001',
        plan: 'basic' as const,
        paymentMethodId: 'pm-001'
    };

    async function expireTrial(subscriptionId: string): Promise<void> {
        db.prepare(`
            UPDATE subscriptions
            SET trial_ends_at = ?
            WHERE id = ?
        `).run(
            new Date(Date.now() - 1000).toISOString(),
            subscriptionId
        );
    }

    it('should create a Basic subscription with a 7-day trial', async () => {
        const subscription = await service.createSubscription(input);

        expect(subscription.status).toBe('trialing');
        expect(subscription.amount).toBe(1000);
        expect(subscription.currency).toBe('USD');

        const trialDuration =
            subscription.trialEndsAt.getTime() -
            subscription.trialStartsAt.getTime();

        expect(trialDuration).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should not call payment provider during subscription creation', async () => {
        const paymentSpy = jest.spyOn(
            paymentProvider,
            'processPayment'
        );

        const subscription = await service.createSubscription(input);

        expect(subscription.status).toBe('trialing');
        expect(paymentSpy).not.toHaveBeenCalled();
    });

    it('should create a Pro subscription with a 14-day trial', async () => {
        const subscription = await service.createSubscription({
            ...input,
            plan: 'pro'
        });

        expect(subscription.plan).toBe('pro');
        expect(subscription.amount).toBe(4900);
        expect(subscription.currency).toBe('USD');

        const trialDuration =
            subscription.trialEndsAt.getTime() -
            subscription.trialStartsAt.getTime();

        expect(trialDuration).toBe(14 * 24 * 60 * 60 * 1000);
    });

    it('should activate subscription when payment succeeds after trial expiry', async () => {
        const subscription = await service.createSubscription(input);

        await expireTrial(subscription.id);
        paymentProvider.setNextStatus('success');

        const result = await service.chargeTrialSubscription(
            subscription.id
        );

        expect(result.status).toBe('active');
    });

    it('should mark subscription past_due when payment fails after trial expiry', async () => {
        const subscription = await service.createSubscription(input);

        await expireTrial(subscription.id);
        paymentProvider.setNextStatus('failed');

        const result = await service.chargeTrialSubscription(
            subscription.id
        );

        expect(result.status).toBe('past_due');
    });

    it('should remain trialing when payment times out', async () => {
        const subscription = await service.createSubscription(input);

        await expireTrial(subscription.id);
        paymentProvider.setNextStatus('timeout');

        const result = await service.chargeTrialSubscription(
            subscription.id
        );

        expect(result.status).toBe('trialing');
    });

    it('should reject payment before trial expiry', async () => {
        const subscription = await service.createSubscription(input);

        await expect(
            service.chargeTrialSubscription(subscription.id)
        ).rejects.toThrow('Subscription trial period has not ended');
    });

    it('should reject charging a subscription that is already active', async () => {
        const subscription = await service.createSubscription(input);

        await expireTrial(subscription.id);
        paymentProvider.setNextStatus('success');

        await service.chargeTrialSubscription(subscription.id);

        await expect(
            service.chargeTrialSubscription(subscription.id)
        ).rejects.toThrow('Only trialing subscriptions can be charged');
    });
});
