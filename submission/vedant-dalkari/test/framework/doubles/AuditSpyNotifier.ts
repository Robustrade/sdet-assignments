/**
 * Spy test double capturing customer notifications to verify idempotency.
 * Author: Vedant Dalkari
 */

import type {
  NotificationEventType,
  NotificationMessage,
  Notifier,
} from '../../../src/ports/Notifier.js';

export class AuditSpyNotifier implements Notifier {
  private readonly recorded: NotificationMessage[] = [];

  public get events(): readonly NotificationMessage[] {
    return [...this.recorded];
  }

  public count(): number {
    return this.recorded.length;
  }

  public forSubscription(subscriptionId: string): NotificationMessage[] {
    return this.recorded.filter((event) => event.subscriptionId === subscriptionId);
  }

  public ofType(eventType: NotificationEventType): NotificationMessage[] {
    return this.recorded.filter((event) => event.eventType === eventType);
  }

  public lastEvent(): NotificationMessage | undefined {
    return this.recorded.at(-1);
  }

  public reset(): void {
    this.recorded.length = 0;
  }

  public async notify(message: NotificationMessage): Promise<void> {
    await Promise.resolve();
    this.recorded.push(message);
  }
}
