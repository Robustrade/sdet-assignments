/** Customer-facing side effect. Modelled so tests can prove it fires exactly once under webhook redelivery. */
export interface Notifier {
  subscriptionActivated(subscriptionId: string): void;
}
