import { test as base } from '@playwright/test';
import { TransferApiClient } from '../helpers/transfer-api-client';
import { DbAssertions } from '../helpers/db-assertions';

export const test = base.extend<{
  api: TransferApiClient;
  db: DbAssertions;
}>({
  api: async ({ request }, use) => {
    const client = new TransferApiClient(request);
    await client.resetDatabase(); // fresh state per test
    await use(client);
  },
  db: async ({}, use) => {
    await use(new DbAssertions());
  },
});

export { expect } from '@playwright/test';
