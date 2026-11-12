import type { Clock } from '../domain/clock';
import { SubscriptionStateMachine } from '../domain/subscriptionStateMachine';
import type { ChangeSource, LifecycleTrigger, Subscription } from '../domain/types';
import type { Repositories } from '../persistence/repositories';
import type { SubscriptionPatch } from '../persistence/repositories/subscriptionRepository';

export interface ChangeContext {
  readonly source: ChangeSource;
  /** Invoice id or webhook event id that caused the change, if any. */
  readonly reference: string | null;
}

export type AuditEventName = 'renewal_succeeded' | 'retry_failed' | 'payment_refunded';

/**
 * Applies status changes through the state machine and writes the audit entry for each one.
 * Callers run it inside a DB transaction so the status and its audit entry are saved together.
 */
export class SubscriptionLifecycle {
  constructor(
    private readonly repos: Repositories,
    private readonly clock: Clock,
  ) {}

  recordCreated(subscription: Subscription, context: ChangeContext): void {
    this.repos.audit.record({
      subscriptionId: subscription.id,
      kind: 'created',
      fromStatus: null,
      toStatus: subscription.status,
      trigger: 'subscription_created',
      source: context.source,
      reference: context.reference,
      createdAt: subscription.createdAt,
    });
  }

  /** Throws IllegalTransitionError if the lifecycle doesn't allow `trigger` from the current status. */
  apply(subscription: Subscription, trigger: LifecycleTrigger, context: ChangeContext, patch: SubscriptionPatch = {}): Subscription {
    const transition = SubscriptionStateMachine.transition(subscription.status, trigger);
    const now = this.clock.now().toISOString();
    this.repos.subscriptions.applyTransition(subscription, transition, patch, now);
    this.repos.audit.record({
      subscriptionId: subscription.id,
      kind: 'transition',
      fromStatus: transition.from,
      toStatus: transition.to,
      trigger: transition.trigger,
      source: context.source,
      reference: context.reference,
      createdAt: now,
    });
    return this.repos.subscriptions.getById(subscription.id);
  }

  /** Records something that happened without a status change. */
  recordEvent(subscription: Subscription, event: AuditEventName, context: ChangeContext): void {
    this.repos.audit.record({
      subscriptionId: subscription.id,
      kind: 'event',
      fromStatus: subscription.status,
      toStatus: subscription.status,
      trigger: event,
      source: context.source,
      reference: context.reference,
      createdAt: this.clock.now().toISOString(),
    });
  }
}
