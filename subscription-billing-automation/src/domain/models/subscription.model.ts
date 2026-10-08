import { SubscriptionState, SubscriptionStatus, InvalidTransitionError } from '../state/subscription-state.interface';
import { TrialingState } from '../state/trialing.state';

export interface SubscriptionSnapshot {
  id: string;
  customerId: string;
  plan: string;
  paymentMethodId: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  createdAt: string;
  history: string[];
}

export class Subscription {
  private state: SubscriptionState;
  readonly history: string[];

  constructor(
    readonly id: string,
    readonly customerId: string,
    readonly plan: string,
    readonly paymentMethodId: string,
    initialState: SubscriptionState = new TrialingState(),
    readonly trialEndsAt: string | null = null,
    readonly createdAt: string = new Date().toISOString(),
    history: string[] = [],
  ) {
    this.state = initialState;
    this.history = [...history];
  }

  get status(): SubscriptionStatus {
    return this.state.status;
  }

  paymentSucceeded(): void {
    this.transition(() => this.state.paymentSucceeded(), 'payment.succeeded');
  }

  paymentFailed(retriesExhausted = false): void {
    this.transition(() => this.state.paymentFailed(retriesExhausted), 'payment.failed');
  }

  cancel(): void {
    this.transition(() => this.state.cancel(), 'cancel');
  }

  snapshot(): SubscriptionSnapshot {
    return {
      id: this.id,
      customerId: this.customerId,
      plan: this.plan,
      paymentMethodId: this.paymentMethodId,
      status: this.status,
      trialEndsAt: this.trialEndsAt,
      createdAt: this.createdAt,
      history: [...this.history],
    };
  }

  private transition(apply: () => SubscriptionState, event: string): void {
    if (this.status === 'canceled') {
      throw new InvalidTransitionError(this.status, event);
    }
    const next = apply();
    if (next.status !== this.status) {
      this.history.push(`${this.status}->${next.status}:${event}`);
    }
    this.state = next;
  }
}
