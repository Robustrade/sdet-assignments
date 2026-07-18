import { createApp, type AppContext } from '../../src/service/app';
import { ApiClient } from '../helpers/apiClient';
import { DbHelpers } from '../helpers/dbHelpers';

export interface TestContext {
  appContext: AppContext;
  api: ApiClient;
  dbHelpers: DbHelpers;
}

export function createTestContext(): TestContext {
  const appContext = createApp();
  const api = new ApiClient(appContext.app);
  const dbHelpers = new DbHelpers(appContext.db);
  return { appContext, api, dbHelpers };
}

export const SEED_BALANCES = {
  wallet_001: 10000,
  wallet_002: 5000,
  wallet_003: 0,
} as const;
