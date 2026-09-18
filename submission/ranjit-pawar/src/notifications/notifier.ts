export type NotificationType =
  | 'subscription_activated'
  | 'payment_failed'
  | 'subscription_canceled'
  | 'payment_refunded';

export interface Notification {
  type: NotificationType;
  subscriptionId: string;
  customerId: string;
  invoiceId?: string;
  at: string;
}

/**
 * A modelled, observable side effect. Its only job in this fixture is to make
 * "a duplicate webhook must not fire a side effect twice" a provable assertion
 * rather than a claim.
 */
export interface Notifier {
  notify(notification: Notification): void;
}

export class NoopNotifier implements Notifier {
  notify(): void {
    /* production stand-in */
  }
}
