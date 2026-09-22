export interface PlanConfig {
  readonly name: 'basic' | 'pro';
  readonly price: number;
  readonly trialDays: number;
}
