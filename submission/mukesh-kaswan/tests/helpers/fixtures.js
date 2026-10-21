const { once } = require('node:events');
const base = require('@playwright/test');
const { createApp } = require('../../src/app');
const { BillingService } = require('../../src/billingService');
const { BillingRepository } = require('../../src/repository');
const { FakePaymentProvider } = require('./FakePaymentProvider');
const { BillingApiClient } = require('./BillingApiClient');
const { BillingAssertions, assertGlobalInvariants } = require('./BillingAssertions');
const { BillingScenarios } = require('./BillingScenarios');
const { WEBHOOK_SECRET, SEEDED_CUSTOMERS } = require('./testConfig');

/**
 * Every test gets its own fresh store, fake provider and server on a random
 * port, so tests are isolated and can run in parallel with no cleanup step.
 */
const test = base.test.extend({
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    const db = new BillingRepository();
    SEEDED_CUSTOMERS.forEach((customer) => db.addCustomer(customer));
    await use(db);
  },

  // eslint-disable-next-line no-empty-pattern
  provider: async ({}, use) => {
    await use(new FakePaymentProvider());
  },

  api: async ({ db, provider, playwright }, use) => {
    const service = new BillingService({ repository: db, paymentProvider: provider });
    const server = createApp({ service, webhookSecret: WEBHOOK_SECRET }).listen(0, '127.0.0.1');
    await once(server, 'listening');

    const request = await playwright.request.newContext({
      baseURL: `http://127.0.0.1:${server.address().port}`,
    });
    await use(new BillingApiClient(request));

    await request.dispose();
    await new Promise((resolve) => server.close(resolve));
  },

  verify: async ({ api, db, provider }, use) => {
    await use(new BillingAssertions({ api, db, provider }));
  },

  given: async ({ api }, use) => {
    await use(new BillingScenarios(api));
  },

  // Runs for every test, after the test body.
  globalInvariants: [
    async ({ db, provider }, use) => {
      await use();
      assertGlobalInvariants({ db, provider });
    },
    { auto: true },
  ],
});

module.exports = { test, expect: base.expect };
