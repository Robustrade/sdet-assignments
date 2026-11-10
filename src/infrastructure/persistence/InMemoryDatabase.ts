/**
 * In-Memory Database Implementation
 *
 * Simulates a database using Map structures for testing.
 * Avoids native dependency issues with SQLite.
 */

import { Subscription, Invoice, WebhookEvent } from '../../domain/subscription/types';

export class InMemoryDatabase {
  subscriptions: Map<string, Subscription> = new Map();
  invoices: Map<string, Invoice> = new Map();
  webhookEvents: WebhookEvent[] = [];

  clear(): void {
    this.subscriptions.clear();
    this.invoices.clear();
    this.webhookEvents = [];
  }
}

export function createInMemoryDatabase(): InMemoryDatabase {
  return new InMemoryDatabase();
}
