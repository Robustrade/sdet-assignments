
import { randomUUID } from "crypto";
import { Subscription } from "../domain/Subscription";
import { SubscriptionStateMachine, SubscriptionStatus } from "../domain/SubscriptionStateMachine";
import { SubscriptionRepository } from "../repositories/SubscriptionRepository";

export class SubscriptionService {
  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly stateMachine: SubscriptionStateMachine
  ) {}

  async createSubscription(
    customerId: string,
    planId: string
  ): Promise<Subscription> {
    if (!customerId?.trim() || !planId?.trim()) {
      throw new Error("Customer ID and Plan ID are required");
    }

    const now = new Date();

    const subscription: Subscription = {
      id: randomUUID(),
      customerId,
      planId,
      status: "trialing",
      createdAt: now,
      updatedAt: now
    };

    await this.repository.save(subscription);
    return subscription;
  }

  async getSubscription(id: string): Promise<Subscription | null> {
    return this.repository.findById(id);
  }

  async changeStatus(
    id: string,
    nextStatus: SubscriptionStatus
  ): Promise<Subscription> {
    const subscription = await this.repository.findById(id);

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    const status = this.stateMachine.transition(
      subscription.status,
      nextStatus
    );

    const updated: Subscription = {
      ...subscription,
      status,
      updatedAt: new Date()
    };

    await this.repository.save(updated);

    return updated;
  }
}
