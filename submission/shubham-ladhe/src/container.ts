import express from 'express';
import { PlanCatalog } from './domain/plans';
import { Clock, SystemClock } from './domain/time';
import { createHttpApp } from './http/app';
import { PaymentGateway } from './payments/PaymentGateway';
import { Repositories } from './persistence/repositories';
import { SqlDatabase } from './persistence/SqlDatabase';
import { BillingEngine } from './services/BillingEngine';
import { IdGenerator, SequentialIds } from './services/ids';
import { PaymentOutcomes } from './services/PaymentOutcomes';
import { SubscriptionService } from './services/SubscriptionService';
import { WebhookService } from './services/WebhookService';
import { WebhookSignature } from './services/WebhookSignature';

export interface ServiceDependencies {
  db: SqlDatabase;
  gateway: PaymentGateway;
  webhookSecret: string;
  clock?: Clock;
  ids?: IdGenerator;
  plans?: PlanCatalog;
  /** Swap individual repositories, e.g. for fault injection in tests. */
  repositoryOverrides?: (db: SqlDatabase) => Partial<Omit<Repositories, 'db'>>;
}

export interface BillingService {
  app: express.Express;
  repos: Repositories;
  subscriptions: SubscriptionService;
  webhooks: WebhookService;
  billing: BillingEngine;
}

/** Composition root: the only place that knows which concrete implementations are wired together. */
export function buildBillingService(deps: ServiceDependencies): BillingService {
  const clock = deps.clock ?? new SystemClock();
  const ids = deps.ids ?? new SequentialIds();
  const plans = deps.plans ?? new PlanCatalog();
  const repos = new Repositories(deps.db, deps.repositoryOverrides?.(deps.db));

  const outcomes = new PaymentOutcomes(repos, plans, ids);
  const billing = new BillingEngine(deps.db, repos, plans, deps.gateway, outcomes, clock, ids);
  const subscriptions = new SubscriptionService(deps.db, repos, plans, billing, clock, ids);
  const webhooks = new WebhookService(deps.db, repos, outcomes, new WebhookSignature(deps.webhookSecret), clock);

  return { app: createHttpApp(subscriptions, webhooks), repos, subscriptions, webhooks, billing };
}
