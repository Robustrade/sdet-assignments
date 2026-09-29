const DAY_MS = 24 * 60 * 60 * 1000;
export const BILLING_PERIOD_DAYS = 30;

/**
 * Strategy: how a plan prices and schedules billing. Services ask the policy instead
 * of branching on plan names, so creation and billing cannot disagree on price (INV-6).
 */
export interface PlanPolicy {
  readonly code: string;
  readonly amount: number;
  readonly currency: string;
  /** When the first charge is due. */
  trialEndsAt(signup: Date): Date;
  /** Whether the first charge happens inside the signup request. */
  readonly chargesAtSignup: boolean;
}

class FreeTrialPolicy implements PlanPolicy {
  readonly chargesAtSignup = false;

  constructor(
    readonly code: string,
    readonly amount: number,
    readonly currency: string,
    private readonly trialDays: number,
  ) {}

  trialEndsAt(signup: Date): Date {
    return new Date(signup.getTime() + this.trialDays * DAY_MS);
  }
}

class ChargeAtSignupPolicy implements PlanPolicy {
  readonly chargesAtSignup = true;

  constructor(
    readonly code: string,
    readonly amount: number,
    readonly currency: string,
  ) {}

  trialEndsAt(signup: Date): Date {
    return new Date(signup);
  }
}

export class PlanCatalog {
  private readonly plans: ReadonlyMap<string, PlanPolicy>;

  constructor(
    plans: readonly PlanPolicy[] = [
      new FreeTrialPolicy('basic', 1900, 'USD', 14),
      new ChargeAtSignupPolicy('pro', 4900, 'USD'),
    ],
  ) {
    this.plans = new Map(plans.map((p) => [p.code, p]));
  }

  find(code: string): PlanPolicy | undefined {
    return this.plans.get(code);
  }

  get(code: string): PlanPolicy {
    const plan = this.find(code);
    if (!plan) throw new Error(`unknown plan ${code}`);
    return plan;
  }
}

export function nextPeriodEnd(from: Date): string {
  return new Date(from.getTime() + BILLING_PERIOD_DAYS * DAY_MS).toISOString();
}
