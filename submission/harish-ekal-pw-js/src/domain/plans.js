class PlanStrategy {
  constructor(code, priceCents, trialDays) {
    this.code = code;
    this.priceCents = priceCents;
    this.trialDays = trialDays;
  }

  startsInTrial() {
    return this.trialDays > 0;
  }
}

class BasicPlanStrategy extends PlanStrategy {
  constructor() {
    super('basic', 1900, 14);
  }
}

class ProPlanStrategy extends PlanStrategy {
  constructor() {
    super('pro', 4900, 0);
  }
}

class PlanFactory {
  static create(planCode) {
    if (planCode === 'basic') return new BasicPlanStrategy();
    if (planCode === 'pro') return new ProPlanStrategy();
    throw new Error('UNKNOWN_PLAN');
  }
}

module.exports = {
  PlanFactory,
};
