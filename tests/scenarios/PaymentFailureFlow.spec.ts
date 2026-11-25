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
  "Payment Failure Flow",
  () => {

    test(
      "active becomes past due after failed payment",
      () => {

        const service =
          new SubscriptionLifecycleService();

        const subscription =
          new SubscriptionBuilder()
            .withStatus(
              SubscriptionStatus.ACTIVE
            )
            .build();

        service.transition(
          subscription,
          SubscriptionStatus.PAST_DUE
        );

        expect(
          subscription.status
        ).toBe(
          SubscriptionStatus.PAST_DUE
        );

      }
    );

  }
);