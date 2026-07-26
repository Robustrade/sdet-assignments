const { createApp } = require('../../../src/http/createApp');
const {
  SubscriptionService,
} = require('../../../src/application/subscriptionService');
const {
  InMemorySubscriptionRepository,
  InMemoryInvoiceRepository,
  InMemoryWebhookEventRepository,
  InMemoryAuditLogRepository,
} = require('../../../src/infrastructure/inMemoryRepositories');
const {
  FakePaymentProvider,
} = require('../../../src/infrastructure/fakePaymentProvider');

function createTestApp() {
  const subscriptionRepo = new InMemorySubscriptionRepository();
  const invoiceRepo = new InMemoryInvoiceRepository();
  const webhookRepo = new InMemoryWebhookEventRepository();
  const auditRepo = new InMemoryAuditLogRepository();
  const paymentProvider = new FakePaymentProvider();
  const customerStore = new Set(['cust_001', 'cust_002']);
  const webhookSecret = 'test_webhook_secret';

  const service = new SubscriptionService({
    subscriptionRepo,
    invoiceRepo,
    webhookRepo,
    auditRepo,
    paymentProvider,
    customerStore,
  });

  const app = createApp({ service, webhookSecret });

  return {
    app,
    service,
    webhookSecret,
    repos: {
      subscriptionRepo,
      invoiceRepo,
      webhookRepo,
      auditRepo,
    },
    paymentProvider,
  };
}

module.exports = {
  createTestApp,
};
