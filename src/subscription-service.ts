
import { randomUUID } from 'node:crypto';
import type {
  Invoice,
  Plan,
  PlanName,
  Subscription,
} from './models.js';
import { InMemoryRepository } from './repository.js';
import { SubscriptionStateMachine } from './state-machine.js';
import type { PaymentProvider } from './payment-provider.js';

export class SubscriptionService {
  constructor(
    private readonly repository: InMemoryRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly stateMachine = new SubscriptionStateMachine(),
  ) {}

  createSubscription(input: {
    customerId: string;
    plan: PlanName;
    paymentMethodId: string;
  }): Subscription {
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
      status: plan.chargeImmediately ? 'active' : 'trialing',
      createdAt: now,
      updatedAt: now,
      trialEndsAt: plan.chargeImmediately
        ? null
        : new Date(Date.now() + plan.trialDays * 86_400_000).toISOString(),
    };

    this.repository.saveSubscription(subscription);
    return subscription;
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
      subscriptionId,
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

    if (result.success && subscription.status !== 'active') {
      const updatedSubscription = {
        ...subscription,
        status: this.stateMachine.transition(subscription.status, 'active'),
        updatedAt: new Date().toISOString(),
      };

      this.repository.saveSubscription(updatedSubscription);
    } else if (!result.success && subscription.status === 'trialing') {
      this.repository.saveSubscription({
        ...subscription,
        status: this.stateMachine.transition('trialing', 'past_due'),
        updatedAt: new Date().toISOString(),
      });
    } else if (!result.success && subscription.status === 'active') {
      this.repository.saveSubscription({
        ...subscription,
        status: this.stateMachine.transition('active', 'past_due'),
        updatedAt: new Date().toISOString(),
      });
    }

    return updatedInvoice;
  }

  cancelSubscription(subscriptionId: string): Subscription {
    const subscription = this.repository.getSubscription(subscriptionId);
    if (!subscription) {
      throw new Error('Unknown subscription');
    }

    const canceled = {
      ...subscription,
      status: this.stateMachine.transition(subscription.status, 'canceled'),
      updatedAt: new Date().toISOString(),
    };

    this.repository.saveSubscription(canceled);
    return canceled;
  }

  getSubscription(subscriptionId: string): Subscription | undefined {
    return this.repository.getSubscription(subscriptionId);
  }
}
