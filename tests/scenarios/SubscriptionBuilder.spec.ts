import { describe, expect, test } from "vitest";

import { SubscriptionBuilder }
from "../builders/SubscriptionBuilder";

import { SubscriptionStatus }
from "../../src/domain/SubscriptionStatus";

describe(
  "Subscription Builder",
  () => {

    test(
      "builds custom subscription",
      () => {

        const subscription =
          new SubscriptionBuilder()
            .withId("sub_123")
            .withCustomer("cust_999")
            .withPlan("basic")
            .withStatus(
              SubscriptionStatus.ACTIVE
            )
            .build();

        expect(
          subscription.id
        ).toBe("sub_123");

        expect(
          subscription.customerId
        ).toBe("cust_999");

        expect(
          subscription.plan
        ).toBe("basic");

        expect(
          subscription.status
        ).toBe(
          SubscriptionStatus.ACTIVE
        );
      }
    );

  }
);