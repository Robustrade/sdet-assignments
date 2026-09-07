import { PlanConfig, PlanId } from './types';

const PLANS: Record<PlanId, PlanConfig> = {
  basic: { id: 'basic', priceCents: 900, trialDays: 7, currency: 'USD' },
  pro: { id: 'pro', priceCents: 4900, trialDays: 14, currency: 'USD' },
};

export class PlanCatalog {
  static exists(planId: string): planId is PlanId {
    return Object.prototype.hasOwnProperty.call(PLANS, planId);
  }

  static get(planId: string): PlanConfig | undefined {
    return PlanCatalog.exists(planId) ? PLANS[planId] : undefined;
  }

  static all(): PlanConfig[] {
    return Object.values(PLANS);
  }
}
