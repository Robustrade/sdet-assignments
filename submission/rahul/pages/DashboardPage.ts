import { Page, Locator } from '@playwright/test';

export class DashboardPage {
  private readonly page: Page;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', {
      name: /dashboard/i,
    });
  }

  async isDisplayed(): Promise<boolean> {
    return this.heading.isVisible();
  }
}
