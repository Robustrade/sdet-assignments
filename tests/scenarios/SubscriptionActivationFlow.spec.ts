import {
  describe,
  expect,
  test
} from "vitest";

import {
  SubscriptionBuilder
} from "../builders/SubscriptionBuilder";

import {
  SubscriptionLifecycleService
} from "../../src/services/SubscriptionLifecycleService";

import {
  SubscriptionStatus
} from "../../src/domain/SubscriptionStatus";

describe(
  "Subscription Activation Flow",
  () => {

    test(
      "trialing becomes active after successful payment",
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

  }
);