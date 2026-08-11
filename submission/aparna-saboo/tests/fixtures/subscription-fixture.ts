import { SubscriptionBuilder } from '../builders/subscription-builder';

export class SubscriptionFixture {
  static createDefault() {
    return new SubscriptionBuilder().withDefaults().build();
  }
}
