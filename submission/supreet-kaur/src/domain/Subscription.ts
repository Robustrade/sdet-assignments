import { Plan } from "./Plan";
import { SubscriptionContext, SubscriptionState, SubscriptionStatus } from "./states/State";
import { TrialingState } from "./states/TrialingState";

export interface AuditLogEntry {
  at: Date;
  from: SubscriptionStatus | null;
  to: SubscriptionStatus;
  reason: string;
}

/**
 * The aggregate root for the billing domain. Note there is no public `status` setter and no
 * `status: string` field anywhere -- `currentState` is always one of the four State singletons,
 * and the only way it changes is via `transitionTo`, which is only ever called BY a state
 * object reacting to an event (see states/*.ts). This is what "structurally hard to reach"
 * means in practice: to add an illegal transition you would have to add a new method call
 * inside a state class, not just skip a validation check.
 */
export class Subscription implements SubscriptionContext {
  currentState: SubscriptionState = TrialingState;
  retryCount = 0;
  readonly auditLog: AuditLogEntry[] = [];
  readonly createdAt: Date;
  trialEndsAt: Date;

  constructor(
    public readonly id: string,
    public readonly customerId: string,
    public readonly plan: Plan,
    public readonly paymentMethodId: string,
    now: Date = new Date()
  ) {
    this.createdAt = now;
    this.trialEndsAt = new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);
    this.auditLog.push({ at: now, from: null, to: this.currentState.status, reason: "subscription created" });
  }

  get status(): SubscriptionStatus {
    return this.currentState.status;
  }

  transitionTo(next: SubscriptionState, reason: string): void {
    const from = this.currentState.status;
    this.currentState = next;
    this.auditLog.push({ at: new Date(), from, to: next.status, reason });
  }

  incrementRetryCount(): void {
    this.retryCount += 1;
  }

  resetRetryCount(): void {
    this.retryCount = 0;
  }

  recordIgnoredEvent(reason: string): void {
    this.auditLog.push({ at: new Date(), from: this.currentState.status, to: this.currentState.status, reason });
  }
}
