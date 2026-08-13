import type { Plan } from './types.js';

export class PlanCatalog {
  constructor(private readonly plans: readonly Plan[]) {}

  findById(id: string): Plan | undefined {
    return this.plans.find((p) => p.id === id);
  }

  all(): readonly Plan[] {
    return [...this.plans];
  }
}