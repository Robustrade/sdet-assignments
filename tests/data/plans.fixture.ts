import type { Plan } from '../../src/domain/types.js';
import { PLANS } from '../../src/domain/Plan.js';

export const plansFixture: readonly Plan[] = PLANS;

export const BASIC_PLAN = PLANS[0]!;
export const PRO_PLAN = PLANS[1]!;