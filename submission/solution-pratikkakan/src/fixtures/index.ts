import { test as base, request, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { ApiClient } from '../helpers/api-client';
import { DbHelpers } from '../helpers/db-helpers';

type TestEnv = { baseURL: string; dbPath: string };

// Lazy-loaded once per worker process; safe because workers=1 in config
let cachedEnv: TestEnv | null = null;

function loadTestEnv(): TestEnv {
  if (!cachedEnv) {
    const envFile = path.join(process.cwd(), '.test-env.json');
    cachedEnv = JSON.parse(fs.readFileSync(envFile, 'utf-8')) as TestEnv;
  }
  return cachedEnv;
}

type CustomFixtures = {
  apiClient: ApiClient;
  db: DbHelpers;
};

export const test = base.extend<CustomFixtures>({
  // Fresh APIRequestContext per test — avoids cookie/state bleed between tests
  apiClient: async ({}, use) => {
    const { baseURL } = loadTestEnv();
    const ctx = await request.newContext({
      baseURL,
      extraHTTPHeaders: { 'Content-Type': 'application/json' },
    });
    await use(new ApiClient(ctx));
    await ctx.dispose();
  },

  // Direct DB access per test — read-only in most tests, write for seeding
  db: async ({}, use) => {
    const { dbPath } = loadTestEnv();
    const helpers = new DbHelpers(dbPath);
    await use(helpers);
    helpers.close();
  },
});

export { expect };
