
export interface Plan {
    id: string;
    name: string;
    amount: number;
    currency: string;
    trialDays: number;
}

export class PlanCatalog {
    private readonly plans: Record<string, Plan> = {
        plan_basic: {
            id: "plan_basic",
            name: "Basic",
            amount: 1900,
            currency: "USD",
            trialDays: 14
        },
        plan_pro: {
            id: "plan_pro",
            name: "Pro",
            amount: 4900,
            currency: "USD",
            trialDays: 0
        }
    };

    getPlan(planId: string): Plan {
        if (!Object.hasOwn(this.plans, planId)) {
            throw new Error("Invalid plan");
        }

        return { ...this.plans[planId] };
    }
}
