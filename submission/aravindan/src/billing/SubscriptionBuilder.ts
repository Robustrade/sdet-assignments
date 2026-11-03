type PlanName = 'basic' | 'pro';

type PlanConfig = {
  trialDays: number;
  price: number;
  currency: string;
  chargeImmediately: boolean;
};

const planCatalog: Record<PlanName, PlanConfig> = {
  basic: {
    trialDays: 14,
    price: 1000,
    currency: 'USD',
    chargeImmediately: false,
  },
  pro: {
    trialDays: 30,
    price: 4900,
    currency: 'USD',
    chargeImmediately: true,
  },
};

export {};

class SubscriptionBuilder {
  static getPlanConfig(plan: PlanName): PlanConfig {
    const config = planCatalog[plan];
    if (!config) {
      throw new Error(`Unsupported plan: ${plan}`);
    }

    return config;
  }

  static createSubscription({
    customer_id,
    plan,
    payment_method_id,
  }: {
    customer_id: string;
    plan: PlanName;
    payment_method_id: string;
  }) {
    if (!customer_id || !plan || !payment_method_id) {
      throw new Error('customer_id, plan, and payment_method_id are required');
    }

    const config = this.getPlanConfig(plan);
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return {
      id,
      customer_id,
      plan,
      payment_method_id,
      state: 'trialing',
      price: config.price,
      currency: config.currency,
      trial_days: config.trialDays,
      charge_immediately: config.chargeImmediately,
      created_at: new Date().toISOString(),
    };
  }

  static buildWebhookEvent({
    event_id,
    type,
    subscription_id,
    invoice_id,
    amount,
    currency = 'USD',
  }: {
    event_id: string;
    type: string;
    subscription_id: string;
    invoice_id?: string;
    amount: number;
    currency?: string;
  }) {
    return {
      event_id,
      type,
      subscription_id,
      invoice_id,
      amount,
      currency,
    };
  }
}

module.exports = { SubscriptionBuilder, planCatalog };
