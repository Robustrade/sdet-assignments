const BillingRepository = require('./services/billingRepository');
const MockPaymentProvider = require('./services/paymentProvider');
const { SubscriptionService } = require('./services/subscriptionService');

const repository = new BillingRepository();
const paymentProvider = new MockPaymentProvider();
const subscriptionService = new SubscriptionService(repository, paymentProvider);

module.exports = { repository, paymentProvider, subscriptionService };