
import { CustomerRepository } from '../repositories/CustomerRepository';
import { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { createSubscription, Subscription } from '../models/Subscription';
import { canTransition, transitionSubscription } from '../state/SubscriptionStateMachine';

export class SubscriptionService {
  constructor(
    private customerRepository: CustomerRepository,
    private subscriptionRepository: SubscriptionRepository
  ) {}

  create(
    id: string,
    customerId: string,
    planId: string
  ): Subscription {
    const customer = this.customerRepository.findById(customerId);

    if (!customer) {
      throw new Error(`Customer not found: ${customerId}`);
    }

    const subscription = createSubscription(
      id,
      customerId,
      planId,
      'trialing'
    );

    this.subscriptionRepository.create(subscription);

    return subscription;
  }

  getById(id: string): Subscription {
    const subscription = this.subscriptionRepository.findById(id);

    if (!subscription) {
      throw new Error(`Subscription not found: ${id}`);
    }

    return subscription;
  }

  cancel(id: string): Subscription {
    const subscription = this.getById(id);

    if (!canTransition(subscription.status, 'canceled')) {
      throw new Error(
        `Cannot cancel subscription with status: ${subscription.status}`
      );
    }

    const nextStatus = transitionSubscription(
      subscription.status,
      'canceled'
    );

    this.subscriptionRepository.updateStatus(id, nextStatus);

    return this.getById(id);
  }
}
