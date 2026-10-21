const { expect } = require('@playwright/test');
const { aSubscription, aWebhook } = require('./builders');

/**
 * "Given" steps: put a subscription into a known lifecycle state using only
 * the public API and webhooks (no writing to the store directly).
 * Uses the basic plan, so no provider calls happen during setup.
 */
class BillingScenarios {
  constructor(api) {
    this.api = api;
  }

  trialingSubscription(request = aSubscription().onPlan('basic').build()) {
    return this.api.createSubscriptionOk(request);
  }

  async activeSubscription() {
    const sub = await this.trialingSubscription();
    await this.api.sendWebhookOk(aWebhook().paymentSucceeded(sub).build());
    return this.refresh(sub.id);
  }

  async pastDueSubscription() {
    const sub = await this.trialingSubscription();
    await this.api.sendWebhookOk(aWebhook().paymentFailed(sub).build());
    return this.refresh(sub.id);
  }

  async canceledSubscription() {
    const sub = await this.trialingSubscription();
    const res = await this.api.cancelSubscription(sub.id);
    expect(res.status()).toBe(200);
    return res.json();
  }

  async refresh(id) {
    const res = await this.api.getSubscription(id);
    return res.json();
  }
}

module.exports = { BillingScenarios };
