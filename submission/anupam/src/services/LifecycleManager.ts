import { SubscriptionStateMachine, type LifecycleEvent } from '../domain/SubscriptionStateMachine';
import type { Subscription } from '../domain/types';
import type { AuditLogRepository, SubscriptionPatch, SubscriptionRepository } from '../persistence/repositories';
import type { Clock } from '../ports/Clock';
import type { Notifier } from '../ports/Notifier';

/**
 * The single choke point for status changes:
 *   validate (state machine) -> persist (repo) -> audit -> notify.
 * No other class can change `status` (the repository types enforce it).
 */
export class LifecycleManager {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly audit: AuditLogRepository,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  apply(sub: Subscription, event: LifecycleEvent, detail: string, patch: SubscriptionPatch = {}): Subscription {
    const to = SubscriptionStateMachine.next(sub.status, event); // throws if illegal
    const now = this.clock.now().toISOString();
    const saved = this.subscriptions.saveTransition(sub.id, sub.version, to, {
      ...patch,
      updatedAt: now,
      canceledAt: to === 'canceled' ? now : sub.canceledAt,
    });
    this.audit.append({
      subscriptionId: sub.id,
      action: `transition.${event}`,
      fromStatus: sub.status,
      toStatus: to,
      detail,
      at: now,
    });
    if (to !== sub.status) {
      this.notifier.notify({ subscriptionId: sub.id, kind: `subscription.${to}` });
    }
    return saved;
  }
}
