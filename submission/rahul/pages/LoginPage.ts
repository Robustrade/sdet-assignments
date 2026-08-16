import { Page, Locator } from '@playwright/test';
import { secrets } from '../config/secrets';

export class LoginPage {
  private readonly page: Page;
  private readonly usernameInput: Locator;
  private readonly passwordInput: Locator;
  private readonly loginButton: Locator;

  constructor(page: Page) {
    this.page = page;

    this.usernameInput = page.getByLabel('Username');
    this.passwordInput = page.getByLabel('Password');
    this.loginButton = page.getByRole('button', { name: /login/i });
  }

  async navigate(): Promise<void> {
    await this.page.goto('/login');
  }

  async login(
    username: string = secrets.username,
    password: string = secrets.password
  ): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}
