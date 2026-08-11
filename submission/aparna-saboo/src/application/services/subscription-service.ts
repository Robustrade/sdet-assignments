import {
  type Plan,
  type PlanName,
  type Subscription,
  type SubscriptionStatus,
} from '../../domain/models/subscription';
import { subscriptionStateMachine } from '../../domain/state/subscription-state';
import type { PaymentProvider } from '../ports/payment-provider';
import type { SubscriptionRepository } from '../ports/subscription-repository';

export interface CreateSubscriptionInput {
  customerId: string;
  plan: string;
  paymentMethodId: string;
}

export interface SubscriptionService {
  createSubscription(input: CreateSubscriptionInput): Promise<Subscription>;
  getSubscription(id: string): Subscription;
  cancelSubscription(id: string): Promise<Subscription>;
}

const PLAN_CATALOG: Record<PlanName, Plan> = {
  basic: {
    name: 'basic',
    price: 2900,
    currency: 'USD',
    trialLengthDays: 14,
    chargesImmediately: false,
  },
  pro: {
    name: 'pro',
    price: 4900,
    currency: 'USD',
    trialLengthDays: 14,
    chargesImmediately: true,
  },
};

export class DefaultSubscriptionService implements SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  private resolvePlan(planName: string): Plan {
    const normalizedPlan = planName.toLowerCase();

    if (!(normalizedPlan in PLAN_CATALOG)) {
      throw new Error(`Unknown plan: ${planName}`);
    }

    return PLAN_CATALOG[normalizedPlan as PlanName];
  }

  private getNowIso(): string {
    return new Date().toISOString();
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    const plan = this.resolvePlan(input.plan);
    const now = this.getNowIso();
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const subscription: Subscription = {
      id: subscriptionId,
      customerId: input.customerId,
      plan: plan.name,
      status: 'trialing',
      createdAt: now,
      updatedAt: now,
    };

    this.repository.save(subscription);

    if (!plan.chargesImmediately) {
      return subscription;
    }

    const chargeResult = await this.paymentProvider.chargeCustomer({
      customerId: input.customerId,
      amount: plan.price,
      currency: plan.currency,
      paymentMethodId: input.paymentMethodId,
      subscriptionId: subscription.id,
    });

    if (chargeResult.success) {
      subscriptionStateMachine.transition('trialing', 'active');
      subscription.status = 'active';
      subscription.updatedAt = this.getNowIso();
      this.repository.save(subscription);
      return subscription;
    }

    subscriptionStateMachine.transition('trialing', 'past_due');
    subscription.status = 'past_due';
    subscription.updatedAt = this.getNowIso();
    this.repository.save(subscription);

    return subscription;
  }

  getSubscription(id: string): Subscription {
    const subscription = this.repository.findById(id);

    if (!subscription) {
      throw new Error(`Subscription not found: ${id}`);
    }

    return subscription;
  }

  async cancelSubscription(id: string): Promise<Subscription> {
    const subscription = this.repository.findById(id);

    if (!subscription) {
      throw new Error(`Subscription not found: ${id}`);
    }

    if (subscription.status === 'canceled') {
      throw new Error(`Subscription already canceled: ${id}`);
    }

    subscriptionStateMachine.transition(subscription.status, 'canceled');
    subscription.status = 'canceled';
    subscription.updatedAt = this.getNowIso();

    this.repository.save(subscription);

    return subscription;
  }
}
