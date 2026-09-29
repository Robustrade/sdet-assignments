import type { Notifier } from '../../../src/notifier';

export class SpyNotifier implements Notifier {
  private readonly activated: string[] = [];

  subscriptionActivated(subscriptionId: string): void {
    this.activated.push(subscriptionId);
  }

  activationsFor(subscriptionId: string): number {
    return this.activated.filter((id) => id === subscriptionId).length;
  }
}
