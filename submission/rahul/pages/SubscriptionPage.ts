import { Page } from '@playwright/test';

export class SubscriptionPage {
  constructor(private readonly page: Page) {}

  private plan(name: string) {
    return this.page.getByRole('button', {
      name: new RegExp(`subscribe.*${name}`, 'i'),
    });
  }

  async navigate(): Promise<void> {
    await this.page.goto('/subscriptions');
  }

  async subscribe(planName: string): Promise<void> {
    await this.plan(planName).click();
  }

  async getSubscriptionStatus(): Promise<string> {
    return (
      (await this.page.getByTestId('subscription-status').textContent()) ?? ''
    ).trim();
  }
}
