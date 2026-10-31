
import { randomUUID } from 'node:crypto';
import type { Invoice, PlanName, Subscription } from './models.js';
import { InMemoryRepository } from './repository.js';
import { SubscriptionStateMachine } from './state-machine.js';
import type { PaymentProvider } from './payment-provider.js';

export class SubscriptionService {
  constructor(
    private readonly repository: InMemoryRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly stateMachine = new SubscriptionStateMachine(),
  ) {}

  async createSubscription(input: {
    customerId: string;
    plan: PlanName;
    paymentMethodId: string;
  }): Promise<Subscription> {
    const customer = this.repository.getCustomer(input.customerId);

    if (!customer) {
      throw new Error('Unknown customer');
    }

    const plan = this.repository.getPlan(input.plan);

    if (!plan) {
      throw new Error('Unknown plan');
    }

    if (!input.paymentMethodId.trim()) {
      throw new Error('Invalid payment method');
    }

    const now = new Date().toISOString();

    const subscription: Subscription = {
      id: `sub_${randomUUID()}`,
      customerId: customer.id,
      plan: plan.name,
      paymentMethodId: input.paymentMethodId,
      status: 'trialing',
      createdAt: now,
      updatedAt: now,
      trialEndsAt: plan.chargeImmediately
        ? null
        : new Date(Date.now() + plan.trialDays * 86_400_000).toISOString(),
    };

    this.repository.saveSubscription(subscription);

    if (plan.chargeImmediately) {
      await this.chargeSubscription(subscription.id);
    }

    return this.repository.getSubscription(subscription.id)!;
  }

  async chargeSubscription(subscriptionId: string): Promise<Invoice> {
    const subscription = this.repository.getSubscription(subscriptionId);

    if (!subscription) {
      throw new Error('Unknown subscription');
    }

    if (subscription.status === 'canceled') {
      throw new Error('Cannot charge a canceled subscription');
    }

    const plan = this.repository.getPlan(subscription.plan);

    if (!plan) {
      throw new Error('Unknown plan');
    }

    const invoice: Invoice = {
      id: `inv_${randomUUID()}`,
      subscriptionId: subscription.id,
      amount: plan.price,
      currency: plan.currency,
      status: 'pending',
      providerReference: null,
      createdAt: new Date().toISOString(),
    };

    this.repository.saveInvoice(invoice);

    const result = await this.paymentProvider.charge({
      customerId: subscription.customerId,
      paymentMethodId: subscription.paymentMethodId,
      amount: plan.price,
      currency: plan.currency,
      idempotencyKey: invoice.id,
    });

    const updatedInvoice: Invoice = {
      ...invoice,
      status: result.success ? 'paid' : 'failed',
      providerReference: result.reference || null,
    };

    this.repository.saveInvoice(updatedInvoice);

    const currentSubscription =
      this.repository.getSubscription(subscriptionId)!;

    if (result.success && currentSubscription.status !== 'active') {
      const newStatus = this.stateMachine.transition(
        currentSubscription.status,
        'active',
      );

      this.repository.saveSubscription({
        ...currentSubscription,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      });
    } else if (!result.success) {
      if (
        currentSubscription.status === 'trialing' ||
        currentSubscription.status === 'active'
      ) {
        const newStatus = this.stateMachine.transition(
          currentSubscription.status,
          'past_due',
        );

        this.repository.saveSubscription({
          ...currentSubscription,
          status: newStatus,
          updatedAt: new Date().toISOString(),
        });
      }
    }

    return updatedInvoice;
  }

  changePlan(
    subscriptionId: string,
    newPlanName: PlanName,
  ): Subscription {
    const subscription = this.repository.getSubscription(subscriptionId);

    if (!subscription) {
      throw new Error('Unknown subscription');
    }

    if (subscription.status === 'canceled') {
      throw new Error('Cannot change plan for a canceled subscription');
    }

    const newPlan = this.repository.getPlan(newPlanName);

    if (!newPlan) {
      throw new Error('Unknown plan');
    }

    const updatedSubscription: Subscription = {
      ...subscription,
      plan: newPlan.name,
      updatedAt: new Date().toISOString(),
    };

    this.repository.saveSubscription(updatedSubscription);

    return updatedSubscription;
  }

  cancelSubscription(subscriptionId: string): Subscription {
    const subscription = this.repository.getSubscription(subscriptionId);

    if (!subscription) {
      throw new Error('Unknown subscription');
    }

    const newStatus = this.stateMachine.transition(
      subscription.status,
      'canceled',
    );

    const updatedSubscription: Subscription = {
      ...subscription,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };

    this.repository.saveSubscription(updatedSubscription);

    return updatedSubscription;
  }

  getSubscription(subscriptionId: string): Subscription | undefined {
    return this.repository.getSubscription(subscriptionId);
  }
}
