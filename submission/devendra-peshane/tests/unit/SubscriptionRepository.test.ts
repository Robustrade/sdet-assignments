import { SubscriptionBuilder } from "../../src/models/Subscription";
import { InMemorySubscriptionRepository } from "../../src/repositories/SubscriptionRepository";

describe("InMemorySubscriptionRepository", () => {
  let repository: InMemorySubscriptionRepository;

  beforeEach(() => {
    repository = new InMemorySubscriptionRepository();
  });

  test("saves and retrieves a subscription", () => {
    const subscription = new SubscriptionBuilder()
      .withId("sub_101")
      .build();

    repository.save(subscription);

    expect(repository.findById("sub_101")).toEqual(subscription);
  });

  test("returns undefined for an unknown subscription", () => {
    expect(repository.findById("missing")).toBeUndefined();
  });

  test("returns all saved subscriptions", () => {
    const first = new SubscriptionBuilder().withId("sub_101").build();
    const second = new SubscriptionBuilder().withId("sub_102").build();

    repository.save(first);
    repository.save(second);

    expect(repository.findAll()).toHaveLength(2);
  });
});
