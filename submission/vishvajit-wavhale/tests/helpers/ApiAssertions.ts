
import { expect } from 'vitest';

interface ApiResponseBody {
  success?: boolean;
  data?: {
    status?: string;
  };
  message?: string;
  [key: string]: unknown;
}

interface ApiResponse {
  status: number;
  body: ApiResponseBody;
}

export class ApiAssertions {
  static assertSuccess(
    response: ApiResponse,
    expectedStatus = 200
  ): void {
    expect(response.status).toBe(expectedStatus);
    expect(response.body.success).toBe(true);
  }

  static assertFailure(
    response: ApiResponse,
    expectedStatus: number
  ): void {
    expect(response.status).toBe(expectedStatus);
    expect(response.body.success).toBe(false);
  }

  static assertSubscriptionStatus(
    response: ApiResponse,
    expectedStatus: string
  ): void {
    expect(response.body.data?.status).toBe(expectedStatus);
  }

  static assertHasErrorMessage(
    response: ApiResponse
  ): void {
    expect(response.body.message).toBeDefined();
    expect(typeof response.body.message).toBe('string');

    if (typeof response.body.message === 'string') {
      expect(response.body.message.length).toBeGreaterThan(0);
    }
  }
}
