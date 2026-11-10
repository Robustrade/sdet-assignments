export class InventoryPage {
  constructor(page) {
    this.page = page;
    this.title = page.locator('[data-test="title"]');
    this.cartBadge = page.locator('[data-test="shopping-cart-badge"]');
    this.cartLink = page.locator('[data-test="shopping-cart-link"]');
  }

  // e.g. addToCart('sauce-labs-backpack')
  async addToCart(productSlug) {
    await this.page.locator(`[data-test="add-to-cart-${productSlug}"]`).click();
  }

  async openCart() {
    await this.cartLink.click();
  }
}
