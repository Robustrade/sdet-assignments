import { addDays } from './clock';

/**
 * STRATEGY.
 *
 * Every plan-dependent rule (price, trial length, billing period, retry budget)
 * lives behind one interface. Adding a plan means registering another policy,
 * not adding another `if (plan === 'pro')` branch to the billing engine.
 */
export interface PlanPolicy {
  readonly id: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly trialDays: number;
  readonly billingPeriodDays: number;
  /** How many retry attempts are allowed once the subscription is past_due. */
  readonly maxPaymentRetries: number;
  readonly retryIntervalDays: number;

  /** False => the very first charge happens at creation time. */
  startsInTrial(): boolean;
  trialEndsAt(start: Date): Date | null;
  periodEndFrom(start: Date): Date;
  amountDueCents(): number;
}

export interface PlanConfig {
  id: string;
  priceCents: number;
  currency?: string;
  trialDays: number;
  billingPeriodDays?: number;
  maxPaymentRetries?: number;
  retryIntervalDays?: number;
}

export class StandardPlanPolicy implements PlanPolicy {
  readonly id: string;
  readonly priceCents: number;
  readonly currency: string;
  readonly trialDays: number;
  readonly billingPeriodDays: number;
  readonly maxPaymentRetries: number;
  readonly retryIntervalDays: number;

  constructor(config: PlanConfig) {
    this.id = config.id;
    this.priceCents = config.priceCents;
    this.currency = config.currency ?? 'USD';
    this.trialDays = config.trialDays;
    this.billingPeriodDays = config.billingPeriodDays ?? 30;
    this.maxPaymentRetries = config.maxPaymentRetries ?? 2;
    this.retryIntervalDays = config.retryIntervalDays ?? 3;
  }

  startsInTrial(): boolean {
    return this.trialDays > 0;
  }

  trialEndsAt(start: Date): Date | null {
    return this.startsInTrial() ? addDays(start, this.trialDays) : null;
  }

  periodEndFrom(start: Date): Date {
    return addDays(start, this.billingPeriodDays);
  }

  amountDueCents(): number {
    return this.priceCents;
  }
}

/**
 * REGISTRY / FACTORY for plan policies. The single place that decides whether a
 * plan id is legal, used by both request validation and the billing engine so
 * the two can never disagree.
 */
export class PlanCatalog {
  private readonly plans = new Map<string, PlanPolicy>();

  constructor(policies: readonly PlanPolicy[] = []) {
    for (const policy of policies) this.register(policy);
  }

  static default(): PlanCatalog {
    return new PlanCatalog([
      new StandardPlanPolicy({ id: 'basic', priceCents: 1900, trialDays: 7, maxPaymentRetries: 2 }),
      new StandardPlanPolicy({ id: 'pro', priceCents: 4900, trialDays: 14, maxPaymentRetries: 1 }),
      // No trial: charged immediately on creation.
      new StandardPlanPolicy({ id: 'scale', priceCents: 9900, trialDays: 0, maxPaymentRetries: 1 })
    ]);
  }

  register(policy: PlanPolicy): void {
    this.plans.set(policy.id, policy);
  }

  has(id: unknown): boolean {
    return typeof id === 'string' && this.plans.has(id);
  }

  get(id: string): PlanPolicy {
    const plan = this.plans.get(id);
    if (!plan) throw new Error(`Plan policy not registered: ${id}`);
    return plan;
  }

  ids(): string[] {
    return [...this.plans.keys()];
  }
}
