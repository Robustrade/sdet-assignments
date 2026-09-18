import type { Notification, Notifier } from '../../../src/notifications/notifier';

/**
 * Captures the modelled side effect so "a duplicate webhook fires no extra side
 * effects" is an assertion on observed behaviour, not an inference.
 */
export class RecordingNotifier implements Notifier {
  readonly sent: Notification[] = [];

  notify(notification: Notification): void {
    this.sent.push(structuredClone(notification));
  }

  ofType(type: Notification['type']): Notification[] {
    return this.sent.filter((n) => n.type === type);
  }

  forSubscription(subscriptionId: string): Notification[] {
    return this.sent.filter((n) => n.subscriptionId === subscriptionId);
  }

  reset(): void {
    this.sent.length = 0;
  }
}
