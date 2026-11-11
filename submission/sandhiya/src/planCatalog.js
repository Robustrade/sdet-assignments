export class PlanCatalog {
  constructor() {
    this.plans = new Map([
      ['basic', { name: 'basic', price: 2000, currency: 'USD', trialDays: 7, chargeOnCreate: false }],
      ['pro', { name: 'pro', price: 4900, currency: 'USD', trialDays: 14, chargeOnCreate: false }],
    ]);
  }
  get(planName) { return this.plans.get(String(planName || '').trim().toLowerCase()) ?? null; }
}
