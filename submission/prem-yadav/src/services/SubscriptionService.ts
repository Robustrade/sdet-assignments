
import { randomUUID } from 'crypto';
import {
    Subscription,
    SubscriptionStatus
} from '../models/Subscription';
import { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { SubscriptionStateMachine } from '../state-machine/SubscriptionStateMachine';
import { IPaymentProvider } from '../providers/PaymentProvider';
import { PLAN_CONFIG } from '../config/PlanConfiguration';

export interface CreateSubscriptionInput {
    customerId: string;
    plan: 'basic' | 'pro';
    paymentMethodId: string;
}

export class SubscriptionService {
    constructor(
        private readonly repository: SubscriptionRepository,
        private readonly stateMachine: SubscriptionStateMachine,
        private readonly paymentProvider: IPaymentProvider
    ) {}

    async createSubscription(
        input: CreateSubscriptionInput
    ): Promise<Subscription> {
        if (!input.customerId || !input.paymentMethodId) {
            throw new Error('Customer ID and payment method are required');
        }

        const planConfig = PLAN_CONFIG[input.plan];

        if (!planConfig) {
            throw new Error('Invalid subscription plan');
        }

        const now = new Date();

        const trialStartsAt = now;

        const trialEndsAt = new Date(
            now.getTime() + planConfig.trialDays * 24 * 60 * 60 * 1000
        );

        const subscription: Subscription = {
            id: randomUUID(),
            customerId: input.customerId,
            plan: planConfig.plan,
            status: 'trialing',
            amount: planConfig.amount,
            currency: planConfig.currency,
            paymentMethodId: input.paymentMethodId,
            trialStartsAt,
            trialEndsAt,
            createdAt: now,
            updatedAt: now
        };

        // Save subscription without charging during the trial.
        this.repository.create(subscription);

        return this.getSubscription(subscription.id);
    }

    // Charge the customer after the trial period expires.
    async chargeTrialSubscription(id: string): Promise<Subscription> {
        const subscription = this.getSubscription(id);

        if (subscription.status !== 'trialing') {
            throw new Error(
                'Only trialing subscriptions can be charged'
            );
        }

        if (new Date() < subscription.trialEndsAt) {
            throw new Error('Subscription trial period has not ended');
        }

        const paymentResult = await this.paymentProvider.processPayment({
            subscriptionId: subscription.id,
            amount: subscription.amount,
            currency: subscription.currency,
            paymentMethodId: subscription.paymentMethodId,
            idempotencyKey: `trial-end-${subscription.id}`
        });

        let nextStatus: SubscriptionStatus | undefined;

        if (paymentResult.status === 'success') {
            nextStatus = 'active';
        } else if (paymentResult.status === 'failed') {
            nextStatus = 'past_due';
        }

        // On timeout, retain trialing status because the outcome is uncertain.
        if (nextStatus) {
            const updatedStatus = this.stateMachine.transition(
                subscription.status,
                nextStatus
            );

            this.repository.updateStatus(
                subscription.id,
                updatedStatus
            );
        }

        return this.getSubscription(subscription.id);
    }

    getSubscription(id: string): Subscription {
        const subscription = this.repository.findById(id);

        if (!subscription) {
            throw new Error(`Subscription not found: ${id}`);
        }

        return subscription;
    }

    getCustomerSubscriptions(customerId: string): Subscription[] {
        if (!customerId) {
            throw new Error('Customer ID is required');
        }

        return this.repository.findByCustomerId(customerId);
    }

    updateSubscriptionStatus(
        id: string,
        nextStatus: SubscriptionStatus
    ): Subscription {
        const subscription = this.getSubscription(id);

        const updatedStatus = this.stateMachine.transition(
            subscription.status,
            nextStatus
        );

        this.repository.updateStatus(id, updatedStatus);

        return this.getSubscription(id);
    }

    cancelSubscription(id: string): Subscription {
        return this.updateSubscriptionStatus(id, 'canceled');
    }
}
