// Page object for the subscribe page: all locators are here, tests only call the methods.
export class SubscriptionPage {
  constructor(page) {
    this.page = page;
    this.planDropdown = page.getByTestId('plan');
    this.cardDropdown = page.getByTestId('card');
    this.subscribeButton = page.getByTestId('subscribe');
    this.subscriptionId = page.getByTestId('subscription-id');
    this.status = page.getByTestId('status');
    this.cancelButton = page.getByTestId('cancel');
  }

  async open() {
    await this.page.goto('/');
  }

  async subscribe(plan, card) {
    await this.planDropdown.selectOption(plan);
    await this.cardDropdown.selectOption(card);
    await this.subscribeButton.click();
  }

  async cancel() {
    await this.cancelButton.click();
  }
}
