// Bonus UI suite on the public Sauce Labs demo shop (https://www.saucedemo.com).
// Uses the demo users that Sauce Labs publishes on its own login page.
import { test, expect } from '@playwright/test';
import { LoginPage } from './pages/LoginPage.js';
import { InventoryPage } from './pages/InventoryPage.js';
import { CheckoutPage } from './pages/CheckoutPage.js';

const PASSWORD = 'secret_sauce';

test.describe('Sauce Demo shop (UI)', () => {
  test('standard user can log in and sees the products page', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await loginPage.login('standard_user', PASSWORD);

    await expect(page).toHaveURL(/inventory/);
    await expect(new InventoryPage(page).title).toHaveText('Products');
  });

  test('locked out user sees an error and stays on the login page', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.open();
    await loginPage.login('locked_out_user', PASSWORD);

    await expect(loginPage.errorMessage).toContainText('locked out');
    await expect(page).not.toHaveURL(/inventory/);
  });

  test('user can add two items to the cart and complete checkout', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const inventoryPage = new InventoryPage(page);
    const checkoutPage = new CheckoutPage(page);

    await loginPage.open();
    await loginPage.login('standard_user', PASSWORD);
    await inventoryPage.addToCart('sauce-labs-backpack');
    await inventoryPage.addToCart('sauce-labs-bike-light');
    await expect(inventoryPage.cartBadge).toHaveText('2');

    await inventoryPage.openCart();
    await expect(checkoutPage.cartItems).toHaveCount(2);
    await checkoutPage.checkoutWith({ firstName: 'Test', lastName: 'User', postalCode: '560001' });

    await expect(checkoutPage.completeHeader).toHaveText('Thank you for your order!');
  });
});
