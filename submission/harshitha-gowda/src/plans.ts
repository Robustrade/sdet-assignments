/** Plan rules live in one place instead of `if (plan === 'pro')` scattered around. */
export class PlanPolicy {
  constructor(
    readonly name: string,
    readonly amount: number, // minor units (cents)
    readonly currency: string,
    readonly trialDays: number,
  ) {}

  get startsInTrial(): boolean {
    return this.trialDays > 0;
  }
}

export class PlanCatalog {
  private plans = new Map<string, PlanPolicy>();

  constructor(plans: PlanPolicy[]) {
    plans.forEach((p) => this.plans.set(p.name, p));
  }

  static default(): PlanCatalog {
    return new PlanCatalog([
      new PlanPolicy('basic', 2900, 'USD', 0), // charged immediately
      new PlanPolicy('pro', 4900, 'USD', 7), // 7-day trial, charged at trial end
    ]);
  }

  get(name: string): PlanPolicy | undefined {
    return this.plans.get(name);
  }
}
