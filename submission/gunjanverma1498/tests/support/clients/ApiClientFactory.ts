import type { Express } from 'express';
import { BillingApiClient } from './BillingApiClient';

/**
 * Factory for API clients (Factory pattern).
 *
 * Today it builds an in-process client bound to a supertest-driven Express app.
 * The seam exists so the same test suite could target a real deployed
 * environment (building a client over a base URL) without touching any scenario
 * — only the factory would change.
 */
export class ApiClientFactory {
  static forApp(app: Express): BillingApiClient {
    return new BillingApiClient(app);
  }
}
