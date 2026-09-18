import type { Express } from 'express';
import { SystemClock, type Clock } from './domain/clock';
import { RandomIdGenerator, type IdGenerator } from './domain/ids';
import { PlanCatalog } from './domain/plan-policy';
import { SubscriptionStateMachine } from './domain/subscription-state-machine';
import { createApp } from './http/app';
import { NoopNotifier, type Notifier } from './notifications/notifier';
import type { PaymentProvider } from './payments/payment-provider';
import { InMemoryDatabase } from './persistence/in-memory-database';
import { Repositories } from './persistence/repositories';
import { BillingCycleRunner } from './services/billing-cycle-runner';
import { BillingEngine } from './services/billing-engine';
import { HmacSignatureVerifier, type SignatureVerifier } from './services/signature-verifier';
import { SubscriptionService } from './services/subscription-service';
import { WebhookProcessor } from './services/webhook-processor';

export interface BillingSystemOptions {
  provider: PaymentProvider;
  clock?: Clock;
  ids?: IdGenerator;
  notifier?: Notifier;
  plans?: PlanCatalog;
  webhookSecret?: string;
  database?: InMemoryDatabase;
}

export interface BillingSystem {
  app: Express;
  db: InMemoryDatabase;
  repos: Repositories;
  plans: PlanCatalog;
  clock: Clock;
  stateMachine: SubscriptionStateMachine;
  signatures: SignatureVerifier;
  engine: BillingEngine;
  subscriptions: SubscriptionService;
  webhooks: WebhookProcessor;
  billingRunner: BillingCycleRunner;
}

/**
 * COMPOSITION ROOT. Every collaborator is injected, so the test harness builds
 * the exact same object graph as production with two nodes swapped: the payment
 * provider and the clock.
 */
export function createBillingSystem(options: BillingSystemOptions): BillingSystem {
  const db = options.database ?? new InMemoryDatabase();
  const repos = new Repositories(db);
  const plans = options.plans ?? PlanCatalog.default();
  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new RandomIdGenerator();
  const notifier = options.notifier ?? new NoopNotifier();
  const stateMachine = new SubscriptionStateMachine();
  const signatures = new HmacSignatureVerifier(options.webhookSecret ?? 'whsec_test_secret');

  const engine = new BillingEngine({
    repos,
    plans,
    provider: options.provider,
    clock,
    ids,
    stateMachine,
    notifier
  });
  const subscriptions = new SubscriptionService({ repos, plans, clock, ids, engine, stateMachine });
  const webhooks = new WebhookProcessor({ repos, engine, clock, stateMachine });
  const billingRunner = new BillingCycleRunner(repos, engine, clock);

  const app = createApp({ subscriptions, webhooks, billingRunner, repos, signatures });

  return {
    app,
    db,
    repos,
    plans,
    clock,
    stateMachine,
    signatures,
    engine,
    subscriptions,
    webhooks,
    billingRunner
  };
}
