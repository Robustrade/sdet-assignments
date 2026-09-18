import type { Plan, Subscription } from '../../src/domain/Subscription.js';
import type { SubscriptionState } from '../../src/domain/SubscriptionState.js';

export class SubscriptionBuilder {
    private value: Subscription = {
        id: `sub-${crypto.randomUUID()}`,
        customerId: `customer-${crypto.randomUUID()}`,
        plan: 'basic',
        status: 'trialing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    with(overrides: Partial<Subscription>): this {
        this.value = { ...this.value, ...overrides };
        return this;
    }

    forPlan(plan: Plan): this {
        return this.with({ plan });
    }

    withStatus(status: SubscriptionState): this {
        return this.with({ status });
    }

    build(): Subscription {
        return { ...this.value };
    }
}
