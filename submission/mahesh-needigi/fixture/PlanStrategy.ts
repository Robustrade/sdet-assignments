export interface PlanConfig {
  readonly name: string;
  readonly priceCents: number;
  readonly trialDays: number;
  readonly chargeImmediately: boolean;
}

export interface PlanStrategy {
  getConfig(): PlanConfig;
}

export class BasicPlanStrategy implements PlanStrategy {
  readonly config: PlanConfig;

  constructor() {
    this.config = { name: 'basic', priceCents: 1900, trialDays: 0, chargeImmediately: true };
  }

  getConfig(): PlanConfig {
    return this.config;
  }
}

export class ProPlanStrategy implements PlanStrategy {
  readonly config: PlanConfig;

  constructor() {
    this.config = { name: 'pro', priceCents: 4900, trialDays: 14, chargeImmediately: false };
  }

  getConfig(): PlanConfig {
    return this.config;
  }
}

export class PlanStrategyResolver {
  readonly strategies: { [key: string]: PlanStrategy };

  constructor() {
    this.strategies = {
      basic: new BasicPlanStrategy(),
      pro: new ProPlanStrategy(),
    };
  }

  resolve(plan: string): PlanStrategy {
    const strategy = this.strategies[plan?.toLowerCase()];
    if (!strategy) {
      throw new Error(`Unsupported plan tier: ${plan}`);
    }
    return strategy;
  }
}
