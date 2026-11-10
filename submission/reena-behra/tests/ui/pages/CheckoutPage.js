export class CheckoutPage {
  constructor(page) {
    this.page = page;
    this.cartItems = page.locator('[data-test="inventory-item"]');
    this.checkoutButton = page.locator('[data-test="checkout"]');
    this.firstName = page.locator('[data-test="firstName"]');
    this.lastName = page.locator('[data-test="lastName"]');
    this.postalCode = page.locator('[data-test="postalCode"]');
    this.continueButton = page.locator('[data-test="continue"]');
    this.finishButton = page.locator('[data-test="finish"]');
    this.completeHeader = page.locator('[data-test="complete-header"]');
  }

  async checkoutWith({ firstName, lastName, postalCode }) {
    await this.checkoutButton.click();
    await this.firstName.fill(firstName);
    await this.lastName.fill(lastName);
    await this.postalCode.fill(postalCode);
    await this.continueButton.click();
    await this.finishButton.click();
  }
}
