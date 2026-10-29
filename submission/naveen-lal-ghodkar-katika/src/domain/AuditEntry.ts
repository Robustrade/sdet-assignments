import type { SubscriptionStatus } from './Subscription';
import type { SubscriptionTrigger, TransitionResult } from './SubscriptionStateMachine';

export type AuditSource = 'api' | 'webhook' | 'scheduler';

/** One state transition of a subscription. Only real transitions are recorded, never no-ops. */
export interface AuditEntry {
  readonly subscriptionId: string;
  readonly from: SubscriptionStatus;
  readonly to: SubscriptionStatus;
  readonly trigger: SubscriptionTrigger;
  readonly source: AuditSource;
  /** The webhook event that caused the transition (webhook source only). */
  readonly eventId?: string;
  readonly at: string;
}

/** The only way audit entries are built, so every writer records transitions the same way. */
export function auditEntryFor(
  subscriptionId: string,
  transition: TransitionResult,
  source: AuditSource,
  at: Date,
  eventId?: string,
): AuditEntry {
  return {
    subscriptionId,
    from: transition.from,
    to: transition.to,
    trigger: transition.trigger,
    source,
    ...(eventId === undefined ? {} : { eventId }),
    at: at.toISOString(),
  };
}
