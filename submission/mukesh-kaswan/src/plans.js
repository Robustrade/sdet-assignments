/**
 * Plan catalogue. Prices are in cents.
 * trial_days = 0 means the plan is charged immediately at creation.
 */
const PLANS = Object.freeze({
  basic: { id: 'basic', price: 1900, currency: 'USD', trial_days: 14 },
  pro: { id: 'pro', price: 4900, currency: 'USD', trial_days: 0 },
});

function findPlan(planId) {
  return Object.hasOwn(PLANS, planId) ? PLANS[planId] : null;
}

module.exports = { PLANS, findPlan };
