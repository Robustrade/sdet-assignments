import { createApp } from '../../src/app';
import { createDatabase } from '../../src/database';
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
  const service = new SubscriptionService(
    subscriptionRepository,
    paymentRepository,
    webhookRepository,
    paymentProvider,
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
