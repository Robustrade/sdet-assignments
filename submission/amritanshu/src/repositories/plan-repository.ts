import type { Plan, PlanId } from "../domain/plan.js";

export interface PlanRepository {
  save(plan: Plan): void;
  findById(id: PlanId): Plan | undefined;
}