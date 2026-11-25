import {
  describe,
  test,
  expect
} from "vitest";

import {
  SubscriptionLifecycleService
} from "../../src/services/SubscriptionLifecycleService";

import {
  SubscriptionStatus
} from "../../src/domain/SubscriptionStatus";

import {
  SubscriptionBuilder
} from "../builders/SubscriptionBuilder";

describe(
  "Subscription Lifecycle Service",
  () => {

    test(
      "TRIALING to ACTIVE",
      () => {

        const service =
          new SubscriptionLifecycleService();

        const subscription =
          new SubscriptionBuilder()
            .withStatus(
              SubscriptionStatus.TRIALING
            )
            .build();

        service.transition(
          subscription,
          SubscriptionStatus.ACTIVE
        );

        expect(
          subscription.status
        ).toBe(
          SubscriptionStatus.ACTIVE
        );

      }
    );

    test(
      "rejects CANCELED to ACTIVE",
      () => {

        const service =
          new SubscriptionLifecycleService();

        const subscription =
          new SubscriptionBuilder()
            .withStatus(
              SubscriptionStatus.CANCELED
            )
            .build();

        expect(() =>
          service.transition(
            subscription,
            SubscriptionStatus.ACTIVE
          )
        ).toThrow();

      }
    );

  }
);