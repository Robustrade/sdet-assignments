import { expect, APIResponse } from '@playwright/test';

export class ResponseValidator {
  static async expectStatus(
    response: APIResponse,
    expectedStatus: number
  ): Promise<void> {
    expect(response.status()).toBe(expectedStatus);
  }

  static async getJson(
    response: APIResponse
  ): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
  }

  static expectProperty(body: Record<string, unknown>, property: string): void {
    expect(body).toHaveProperty(property);
  }
}
