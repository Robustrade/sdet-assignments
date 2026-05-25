// fixtures/wallet-fixture.js
const { test: base } = require('@playwright/test');
const { createWallet, resetDB } = require('../utils/api-client');
const { walletId } = require('../utils/data-builders');

/**
 * Extends Playwright test with:
 *  - freshDB   : resets all tables before each test
 *  - wallets   : { src, dst } pre-seeded with given balances
 */
const test = base.extend({
  freshDB: [async ({ request }, use) => {
    await resetDB(request);
    await use();
  }, { auto: true }],

  wallets: async ({ request }, use) => {
    const src = walletId('src');
    const dst = walletId('dst');
    await createWallet(request, src, 10000, 'AED');
    await createWallet(request, dst, 5000,  'AED');
    await use({ src, dst });
  },
});

module.exports = { test };
