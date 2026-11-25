import { describe, test, expect } from "vitest";

import { InMemorySubscriptionRepository }
from "../../src/repositories/InMemorySubscriptionRepository";

import { SubscriptionStatus }
from "../../src/domain/SubscriptionStatus";

describe("Subscription Repository", () => {

  test("saves and retrieves subscription", () => {

    const repository =
      new InMemorySubscriptionRepository();

    const subscription = {
      id: "sub_001",
      customerId: "cust_001",
      plan: "pro",
      status: SubscriptionStatus.TRIALING
    };

    repository.save(subscription);

    const result =
      repository.findById("sub_001");

    expect(result).toEqual(subscription);

  });

});