import { InMemorySubscriptionRepository }
from "./InMemorySubscriptionRepository";

export const repositoryContainer = {
  subscriptions:
    new InMemorySubscriptionRepository()
};