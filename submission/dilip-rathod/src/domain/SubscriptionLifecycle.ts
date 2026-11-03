import type { AuditLogRepository, NotificationOutbox } from '../persistence/repositories/EventRepositories';
import type { SubscriptionPatch, SubscriptionRepository } from '../persistence/repositories/SubscriptionRepository';
import type { AuditEventType, NotificationKind, Subscription } from './types';
import type { LifecycleTrigger } from './SubscriptionStateMachine';

const NOTIFICATION_FOR: Partial<Record<LifecycleTrigger, NotificationKind>> = {
  charge_failed: 'payment_failed',
  retry_failed: 'payment_failed',
  retries_exhausted: 'subscription_canceled',
  cancel_requested: 'subscription_canceled',
};

/**
 * Applies a lifecycle trigger together with its audit entry and customer notification.
 * Must be called inside a database transaction.
 */
export class SubscriptionLifecycle {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly audit: AuditLogRepository,
    private readonly outbox: NotificationOutbox,
  ) {}

  apply(current: Subscription, trigger: LifecycleTrigger, patch: SubscriptionPatch, reference: string | null, atIso: string): Subscription {
    const updated = this.subscriptions.applyTransition(current, trigger, patch, atIso);

    this.audit.append({
      subscriptionId: current.id,
      eventType: auditTypeFor(current, updated, trigger),
      fromStatus: current.status,
      toStatus: updated.status,
      cause: trigger,
      reference,
      atIso,
    });

    const notification =
      trigger === 'charge_succeeded' ? (current.status !== 'active' ? 'subscription_activated' : undefined) : NOTIFICATION_FOR[trigger];
    if (notification) this.outbox.enqueue(current.id, notification, reference, atIso);

    return updated;
  }
}

function auditTypeFor(before: Subscription, after: Subscription, trigger: LifecycleTrigger): AuditEventType {
  if (before.status !== after.status) return 'status_changed';
  return trigger === 'retry_failed' ? 'retry_failed' : 'renewed';
}
