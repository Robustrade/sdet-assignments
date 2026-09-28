import { PlanCatalog } from '../domain/plans';
import { InMemoryDatabase } from '../persistence/InMemoryDatabase';
import { createRepositories, type Repositories } from '../persistence/repositories';
import type { Clock } from '../ports/Clock';
import { SequentialIdGenerator, type IdGenerator } from '../ports/IdGenerator';
import type { Notifier } from '../ports/Notifier';
import type { PaymentProvider } from '../ports/PaymentProvider';
import { BillingEngine } from '../services/BillingEngine';
import { LifecycleManager } from '../services/LifecycleManager';
import { SubscriptionService } from '../services/SubscriptionService';
import { WebhookService } from '../services/WebhookService';
import { WebhookSignatureVerifier } from '../services/WebhookSignatureVerifier';

export interface ContainerDeps {
  paymentProvider: PaymentProvider;
  clock: Clock;
  notifier: Notifier;
  webhookSecret: string;
  db?: InMemoryDatabase;
  ids?: IdGenerator;
  catalog?: PlanCatalog;
}

export interface Container {
  db: InMemoryDatabase;
  repos: Repositories;
  catalog: PlanCatalog;
  billing: BillingEngine;
  subscriptions: SubscriptionService;
  webhooks: WebhookService;
}

/** Composition root: the one place where real vs. fake dependencies are chosen. */
export function buildContainer(deps: ContainerDeps): Container {
  const db = deps.db ?? new InMemoryDatabase();
  const ids = deps.ids ?? new SequentialIdGenerator();
  const catalog = deps.catalog ?? new PlanCatalog();
  const repos = createRepositories(db);
  const lifecycle = new LifecycleManager(repos.subscriptions, repos.audit, deps.notifier, deps.clock);
  const billing = new BillingEngine(repos, catalog, deps.paymentProvider, lifecycle, deps.clock, ids);
  const subscriptions = new SubscriptionService(repos, catalog, billing, lifecycle, deps.clock, ids);
  const webhooks = new WebhookService(repos, billing, new WebhookSignatureVerifier(deps.webhookSecret), deps.clock);
  return { db, repos, catalog, billing, subscriptions, webhooks };
}
