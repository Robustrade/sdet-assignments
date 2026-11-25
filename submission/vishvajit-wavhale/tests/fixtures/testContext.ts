
import { SqliteDatabase } from '../../src/database/Database.js';
import { initializeSchema } from '../../src/database/DatabaseSchema.js';
import { DatabaseSeeder } from '../../src/database/DatabaseSeeder.js';

import { CustomerRepository } from '../../src/repositories/CustomerRepository.js';
import { PlanRepository } from '../../src/repositories/PlanRepository.js';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository.js';
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository.js';
import { WebhookRepository } from '../../src/repositories/WebhookRepository.js';
import { AuditLogRepository } from '../../src/repositories/AuditLogRepository.js';

import { SubscriptionStateMachine } from '../../src/domain/subscription/SubscriptionStateMachine.js';

import { MockPaymentProvider } from '../../src/payment/MockPaymentProvider.js';

import { SubscriptionService } from '../../src/services/SubscriptionService.js';
import { WebhookService } from '../../src/services/WebhookService.js';

import { createApp } from '../../src/api/app.js';

const WEBHOOK_SECRET = 'test-webhook-secret';

export function createTestContext() {
  // 1. Database setup
  const database = new SqliteDatabase();

  initializeSchema(database.connection);
  new DatabaseSeeder(database.connection).seed();

  // 2. Repository setup
  const customerRepository = new CustomerRepository(
    database.connection
  );

  const planRepository = new PlanRepository(
    database.connection
  );

  const subscriptionRepository = new SubscriptionRepository(
    database.connection
  );

  const invoiceRepository = new InvoiceRepository(
    database.connection
  );

  const webhookRepository = new WebhookRepository(
    database.connection
  );

  const auditLogRepository = new AuditLogRepository(
    database.connection
  );

  // 3. Domain and payment setup
  const stateMachine = new SubscriptionStateMachine();
  const paymentProvider = new MockPaymentProvider();

  // 4. Service setup
  const subscriptionService = new SubscriptionService(
    database.connection,
    customerRepository,
    planRepository,
    subscriptionRepository,
    invoiceRepository,
    auditLogRepository,
    stateMachine,
    paymentProvider
  );

  const webhookService = new WebhookService(
    database.connection,
    webhookRepository,
    invoiceRepository,
    subscriptionRepository,
    auditLogRepository,
    stateMachine,
    WEBHOOK_SECRET
  );

  // 5. Express application setup
  const app = createApp({
    subscriptionService,
    webhookService
  });

  // 6. Return reusable test dependencies
  return {
    database,
    app,

    repositories: {
      customerRepository,
      planRepository,
      subscriptionRepository,
      invoiceRepository,
      webhookRepository,
      auditLogRepository
    },

    services: {
      subscriptionService,
      webhookService
    },

    stateMachine,
    paymentProvider,

    webhookSecret: WEBHOOK_SECRET,

    cleanup(): void {
      database.close();
    }
  };
}
