import { test as base } from '@playwright/test';
import { DB } from '../../src/infrastructure/Database';
import { MockPaymentProvider } from '../../src/infrastructure/MockPaymentProvider';
import { createApp } from '../../src/api/server';
import http from 'http';

/** Context fixtures made available to Playwright tests. */
type TestFixtures = {
  /** In-memory DB adapter instance for test isolation. */
  db: DB;
  /** Mocked payment provider used to simulate charge outcomes. */
  paymentProvider: MockPaymentProvider;
  /** URL where the test server is listening (e.g. http://localhost:12345). */
  serverUrl: string;
};

export const test = base.extend<TestFixtures>({
  db: async ({}, use: (value: DB) => Promise<void>) => {
    const db = new DB(true);
    await use(db);
    db.close();
  },
  paymentProvider: async ({}, use: (value: MockPaymentProvider) => Promise<void>) => {
    const provider = new MockPaymentProvider();
    await use(provider);
  },
  serverUrl: async ({ db, paymentProvider }, use) => {
    const app = createApp(db, paymentProvider);
    const server = http.createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as any).port;
    await use(`http://localhost:${port}`);
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
export { expect } from '@playwright/test';
