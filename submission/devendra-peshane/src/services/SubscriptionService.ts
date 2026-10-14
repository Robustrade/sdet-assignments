import {
  SubscriptionBuilder,
  type PlanName,
  type Subscription,
} from "../models/Subscription";
import { SubscriptionStateMachine } from "../models/SubscriptionStateMachine";
import {
  InMemorySubscriptionRepository,
} from "../repositories/SubscriptionRepository";

export class SubscriptionService {
  private nextId = 1;

  constructor(
    private readonly repository = new InMemorySubscriptionRepository(),
    private readonly stateMachine = new SubscriptionStateMachine(),
    private readonly knownCustomers = new Set([
      "cus_test_001",
      "cus_123",
    ])
  ) {}

  create(customerId: unknown, plan: unknown): Subscription {
    if (typeof customerId !== "string" || !customerId.trim()) {
      throw new Error("customerId is required");
    }

    if (!this.knownCustomers.has(customerId)) {
      throw new Error("Unknown customer");
    }

    if (plan !== "basic" && plan !== "pro") {
      throw new Error("Unknown plan");
    }

    const subscription = new SubscriptionBuilder()
      .withId(`sub_${this.nextId++}`)
      .withCustomerId(customerId)
      .withPlan(plan as PlanName)
      .build();

    this.repository.save(subscription);
    return subscription;
  }

  getById(id: string): Subscription | undefined {
    return this.repository.findById(id);
  }

  cancel(id: string): Subscription {
    const subscription = this.repository.findById(id);

    if (!subscription) {
      throw new Error("Subscription not found");
    }

    if (!this.stateMachine.canTransition(subscription.status, "canceled")) {
      throw new Error("Subscription is already canceled");
    }

    const canceled: Subscription = {
      ...subscription,
      status: this.stateMachine.transition(
        subscription.status,
        "canceled"
      ),
    };

    this.repository.save(canceled);
    return canceled;
  }
}
