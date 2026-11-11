
export interface PlanConfiguration {
    plan: 'basic' | 'pro';
    amount: number;
    currency: string;
    trialDays: number;
}

export const PLAN_CONFIG: Record<
    'basic' | 'pro',
    PlanConfiguration
> = {
    basic: {
        plan: 'basic',
        amount: 1000,
        currency: 'USD',
        trialDays: 7
    },
    pro: {
        plan: 'pro',
        amount: 4900,
        currency: 'USD',
        trialDays: 14
    }
};
