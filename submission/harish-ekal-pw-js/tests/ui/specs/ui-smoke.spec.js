const { test } = require('@playwright/test');
const { BasePage } = require('../pom/basePage');

test.skip('ui scaffold with POM', async ({ page }) => {
  const basePage = new BasePage(page);
  await basePage.goto('/');
});
