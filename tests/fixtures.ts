import { expect, test as base } from '@playwright/test';
import { AddressInfo } from 'net';
import { BillingService } from '../src/billingService';
import { Database } from '../src/database';
import { createApp } from '../src/server';
import { findBrokenRules } from './helpers/businessRules';
import { ApiClient, WebhookSender } from './helpers/clients';
import { Given } from './helpers/given';
import { MockPaymentProvider } from './helpers/mockPaymentProvider';
import { TestClock } from './helpers/testClock';

export const WEBHOOK_SECRET = 'test_webhook_secret';

type Fixtures = {
  clock: TestClock;
  paymentProvider: MockPaymentProvider;
  db: Database;
  baseUrl: string;
  api: ApiClient;
  webhook: WebhookSender;
  given: Given;
  checkBusinessRules: void;
};

/**
 * Playwright fixtures = everything a test needs, created fresh for EACH test:
 * its own database, fake payment provider, fake clock and running server.
 * Nothing is shared between tests, so tests never affect each other.
 *
 * REAL:  HTTP server, routes, billing logic, state machine, database rules, signature check
 * FAKE:  payment provider, clock (the database is in memory)
 */
export const test = base.extend<Fixtures>({
  clock: async ({ }, use) => { await use(new TestClock()); },
  paymentProvider: async ({ }, use) => { await use(new MockPaymentProvider()); },
  db: async ({ }, use) => { await use(new Database()); },

  baseUrl: async ({ db, paymentProvider, clock }, use) => {
    const billing = new BillingService(db, paymentProvider, () => clock.now());
    const server = createApp(billing, db, WEBHOOK_SECRET).listen(0); // port 0 = any free port
    await new Promise((resolve) => server.once('listening', resolve));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  },

  api: async ({ playwright, baseUrl }, use) => {
    const request = await playwright.request.newContext({ baseURL: baseUrl });
    await use(new ApiClient(request));
    await request.dispose();
  },

  webhook: async ({ playwright, baseUrl }, use) => {
    const request = await playwright.request.newContext({ baseURL: baseUrl });
    await use(new WebhookSender(request, WEBHOOK_SECRET));
    await request.dispose();
  },

  given: async ({ api, db, paymentProvider, clock }, use) => { await use(new Given(api, db, paymentProvider, clock)); },

  // Runs automatically after EVERY test: the database must still obey all business rules.
  checkBusinessRules: [
    async ({ db }, use) => {
      await use();
      expect(findBrokenRules(db), 'business rules broken after this test').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
