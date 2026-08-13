import type { Express } from 'express';
import type { FakePaymentProvider } from './FakePaymentProvider.js';
import type { WebhookSimulator } from './WebhookSimulator.js';
import type { SubscriptionRepository } from '../../src/persistence/SubscriptionRepository.js';
import type { InvoiceRepository } from '../../src/persistence/InvoiceRepository.js';
import type { WebhookEventRepository } from '../../src/persistence/WebhookEventRepository.js';

export interface TestEnvironment {
  app: Express;
  provider: FakePaymentProvider;
  subscriptions: SubscriptionRepository;
  invoices: InvoiceRepository;
  webhookEvents: WebhookEventRepository;
  signingSecret: string;
  apiClient: ApiClient;
  webhookSimulator: WebhookSimulator;
}

export interface ApiClient {
  createSubscription(
    body: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  getSubscription(
    id: string,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  cancelSubscription(
    id: string,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  postWebhook(
    rawBody: string,
    signature: string | null,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
}