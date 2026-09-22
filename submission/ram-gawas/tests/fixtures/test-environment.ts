import { createApp } from '../../src/app';
import { createDatabase } from '../../src/database';
import { InMemoryCustomerValidator } from '../../src/customer-validator';
import { SubscriptionRepository } from '../../src/repositories/subscription-repository';
import { PaymentRepository } from '../../src/repositories/payment-repository';
import { WebhookEventRepository } from '../../src/repositories/webhook-event-repository';
import { SubscriptionService } from '../../src/subscription-service';
import { MockPaymentProvider } from '../mocks/mock-payment-provider';

export interface TestEnvironment {
  db: ReturnType<typeof createDatabase>;
  service: SubscriptionService;
  app: ReturnType<typeof createApp>;
  subscriptionRepository: SubscriptionRepository;
  paymentRepository: PaymentRepository;
  webhookRepository: WebhookEventRepository;
  paymentProvider: MockPaymentProvider;
}

export function createTestEnvironment(
  webhookSecret = 'test_webhook_secret',
): TestEnvironment {
  const db = createDatabase();
  const subscriptionRepository = new SubscriptionRepository(db);
  const paymentRepository = new PaymentRepository(db);
  const webhookRepository = new WebhookEventRepository(db);
  const paymentProvider = new MockPaymentProvider();
  const customerValidator = new InMemoryCustomerValidator(new Map([
    ['cust_001', ['pm_001', 'pm_test_visa_4242']],
    ['cust_002', ['pm_002']],
  ]));
  const service = new SubscriptionService(
    subscriptionRepository,
    paymentRepository,
    webhookRepository,
    paymentProvider,
    customerValidator,
    db,
  );

  return {
    db,
    service,
    app: createApp(service, webhookSecret),
    subscriptionRepository,
    paymentRepository,
    webhookRepository,
    paymentProvider,
  };
}
