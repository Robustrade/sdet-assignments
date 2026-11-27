/**
 * Customer notification port interface.
 * Author: Vedant Dalkari
 */

export type NotificationEventType =
  | 'subscription.created'
  | 'subscription.activated'
  | 'subscription.past_due'
  | 'subscription.canceled'
  | 'subscription.refunded';

export interface NotificationMessage {
  readonly eventType: NotificationEventType;
  readonly subscriptionId: string;
  readonly customerId: string;
  readonly occurredAt: string;
  readonly details?: Record<string, unknown>;
}

export interface Notifier {
  notify(message: NotificationMessage): Promise<void>;
}
