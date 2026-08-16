import { Page } from '@playwright/test';

export class BillingPage {
  constructor(private readonly page: Page) {}

  async navigate(): Promise<void> {
    await this.page.goto('/billing');
  }

  async getBalance(): Promise<string> {
    return (
      (await this.page.getByTestId('billing-balance').textContent()) ?? ''
    ).trim();
  }

  async pay(amount: string): Promise<void> {
    await this.page.getByLabel('Amount').fill(amount);
    await this.page.getByRole('button', { name: /pay/i }).click();
  }
}
