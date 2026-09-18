import type { SubscriptionState } from './SubscriptionState.js';

export type Plan = 'basic' | 'pro';

export interface Subscription {
    id: string;
    customerId: string;
    plan: Plan;
    status: SubscriptionState;
    createdAt: string;
    updatedAt: string;
}