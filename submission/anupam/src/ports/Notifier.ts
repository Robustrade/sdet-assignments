/** Side effect we must never fire twice for one event (used by idempotency tests). */
export interface Notification {
  subscriptionId: string;
  kind: string;
}
export interface Notifier {
  notify(notification: Notification): void;
}
export class NoopNotifier implements Notifier {
  notify(): void {
    /* production would email the customer */
  }
}
