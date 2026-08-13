import type { TestEnvironment } from './contracts.js';
import { ApiClient } from './ApiClient.js';

export class ApiClientFactory {
  static forEnvironment(env: TestEnvironment): ApiClient {
    return new ApiClient(env);
  }
}