import type { Notification, Notifier } from '../../src/ports/Notifier';

/** Spy for the notification side effect. */
export class RecordingNotifier implements Notifier {
  readonly sent: Notification[] = [];
  notify(n: Notification): void {
    this.sent.push({ ...n });
  }
  for(subscriptionId: string): Notification[] {
    return this.sent.filter((n) => n.subscriptionId === subscriptionId);
  }
}
