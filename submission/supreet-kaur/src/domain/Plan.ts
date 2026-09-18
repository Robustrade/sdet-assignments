/**
 * Plan-specific pricing/trial behaviour lives ONLY here.
 *
 * Design pattern: simple Factory (PlanCatalog.get). Nothing else in the codebase is allowed
 * to hard-code a price or a trial length -- every call site asks the catalog for a Plan object.
 * This is what the assignment calls out directly: "Plan-specific pricing/proration behavior
 * is a natural place to apply a design pattern rather than branching logic scattered across
 * the codebase." Without this, "if (plan === 'pro') ... else if (plan === 'basic') ..." would
 * leak into the service, the webhook handler and the tests.
 */

import { ValidationError } from "./errors";

export type PlanName = "basic" | "pro";

export class Plan {
  constructor(
    public readonly name: PlanName,
    public readonly priceCents: number,
    public readonly currency: string,
    public readonly trialDays: number
  ) {}

  /** True when this plan charges immediately on creation instead of starting a trial window. */
  get chargesImmediately(): boolean {
    return this.trialDays === 0;
  }
}

const CATALOG: Record<PlanName, Plan> = {
  basic: new Plan("basic", 900, "USD", 0), // no trial - charged on creation
  pro: new Plan("pro", 4900, "USD", 14), // 14-day trial before first charge
};

export class PlanCatalog {
  /** Returns the Plan for a given name, or undefined if the plan does not exist. */
  static find(name: string): Plan | undefined {
    return (CATALOG as Record<string, Plan>)[name];
  }

  /** Returns the Plan for a given name, or throws ValidationError. Use at the API boundary. */
  static require(name: string): Plan {
    const plan = PlanCatalog.find(name);
    if (!plan) {
      throw new ValidationError(`Unknown plan '${name}'. Valid plans: ${Object.keys(CATALOG).join(", ")}`);
    }
    return plan;
  }

  static all(): Plan[] {
    return Object.values(CATALOG);
  }
}
