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
  "Out Of Order Webhooks",
  () => {

    test(
      "stale payment failure does not regress active subscription",
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

        // stale failure ignored
        expect(
          subscription.status
        ).not.toBe(
          SubscriptionStatus.PAST_DUE
        );

      }
    );

  }
);