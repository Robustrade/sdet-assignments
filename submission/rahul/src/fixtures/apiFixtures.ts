import { test as base, APIRequestContext } from '@playwright/test';

import { UserApiClient } from '../clients/UserApiClient';
import { SubscriptionApiClient } from '../clients/SubscriptionApiClient';
import { BillingApiClient } from '../clients/BillingApiClient';

type ApiFixtures = {
  userApi: UserApiClient;
  subscriptionApi: SubscriptionApiClient;
  billingApi: BillingApiClient;
};

export const test = base.extend<ApiFixtures>({
  userApi: async ({ request }: { request: APIRequestContext }, use) => {
    await use(new UserApiClient(request));
  },

  subscriptionApi: async ({ request }: { request: APIRequestContext }, use) => {
    await use(new SubscriptionApiClient(request));
  },

  billingApi: async ({ request }: { request: APIRequestContext }, use) => {
    await use(new BillingApiClient(request));
  },
});

export { expect } from '@playwright/test';
