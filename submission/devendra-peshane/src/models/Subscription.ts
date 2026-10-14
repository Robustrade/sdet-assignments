import type { SubscriptionStatus } from "./SubscriptionStateMachine";

export type PlanName = "basic" | "pro";

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanName;
  status: SubscriptionStatus;
  amount: number;
  trialDays: number;
  createdAt: Date;
}

export const PLAN_CONFIG: Record<
  PlanName,
  { amount: number; trialDays: number }
> = {
  basic: { amount: 1000, trialDays: 7 },
  pro: { amount: 2500, trialDays: 14 },
};

export class SubscriptionBuilder {
  private data: Subscription = {
    id: "sub_test_001",
    customerId: "cus_test_001",
    plan: "basic",
    status: "trialing",
    amount: PLAN_CONFIG.basic.amount,
    trialDays: PLAN_CONFIG.basic.trialDays,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  withId(id: string): this {
    this.data.id = id;
    return this;
  }

  withCustomerId(customerId: string): this {
    this.data.customerId = customerId;
    return this;
  }

  withPlan(plan: PlanName): this {
    this.data.plan = plan;
    this.data.amount = PLAN_CONFIG[plan].amount;
    this.data.trialDays = PLAN_CONFIG[plan].trialDays;
    return this;
  }

  withStatus(status: SubscriptionStatus): this {
    this.data.status = status;
    return this;
  }

  build(): Subscription {
    return { ...this.data };
  }
}
