import { test as base, expect } from "@playwright/test";

import { Pool } from "pg";
import { ApiClient } from "../../src/clients/api-client";
import { getDbPool, closeDbConnection } from "../../src/database/db-client";

type TestFixtures = {
  apiClient: ApiClient;
};

type WorkerFixtures = {
  db: Pool;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  apiClient: async ({ request }, use) => {
    const client = new ApiClient(request);
    await use(client);
  },

  db: [
    async ({}, use) => {
      const pool = getDbPool();

      try {
        await use(pool);
      } finally {
        await closeDbConnection();
      }
    },
    { scope: "worker" }
  ]
});

export { expect };
