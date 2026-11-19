import express from 'express';
import { Clock, systemClock } from './clock';
import { createDatabase, Db, transactionRunner } from './db/database';
import { createHttpApp } from './http/app';
import { IdGenerator } from './ids';
import { PaymentProvider } from './providers/payment-provider';
import { createRepositories, Repositories } from './repositories';
import { BillingRunner } from './services/billing-runner';
import { BillingService } from './services/billing-service';
import { Lifecycle } from './services/lifecycle';
import { PaymentOutcomeApplier } from './services/payment-outcome-applier';
import { SubscriptionService } from './services/subscription-service';
import { WebhookService } from './services/webhook-service';

export interface FixtureOptions {
  /** The provider seam: tests inject a mock; nothing here can reach a real provider. */
  paymentProvider: PaymentProvider;
  webhookSecret: string;
  clock?: Clock;
  db?: Db;
  /** Assumption A-06: 1 initial attempt + 2 retries. */
  maxAttemptsPerInvoice?: number;
  logError?: (error: unknown) => void;
}

export interface Fixture {
  db: Db;
  repos: Repositories;
  app: express.Express;
  subscriptions: SubscriptionService;
  webhooks: WebhookService;
  billingRunner: BillingRunner;
}

/**
 * Composition root: builds every object and injects its dependencies by hand
 * (the equivalent of a small Spring @Configuration, without a DI container).
 */
export function buildFixture(options: FixtureOptions): Fixture {
  const db = options.db ?? createDatabase();
  const clock = options.clock ?? systemClock;
  const maxAttempts = options.maxAttemptsPerInvoice ?? 3;
  const ids = new IdGenerator();
  const tx = transactionRunner(db);
  const repos = createRepositories(db);

  const lifecycle = new Lifecycle(repos, clock, ids);
  const applier = new PaymentOutcomeApplier(repos, lifecycle, clock, maxAttempts);
  const billing = new BillingService(repos, tx, clock, ids, options.paymentProvider, applier);
  const subscriptions = new SubscriptionService(repos, tx, clock, ids, lifecycle, billing);
  const webhooks = new WebhookService(repos, tx, clock, applier, options.webhookSecret);
  const billingRunner = new BillingRunner(repos, tx, clock, billing, maxAttempts);
  const app = createHttpApp({ subscriptions, webhooks, logError: options.logError ?? ((e) => console.error(e)) });

  return { db, repos, app, subscriptions, webhooks, billingRunner };
}
