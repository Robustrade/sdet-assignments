import { createApp } from "../../src/api/app.js";

import { CustomerBuilder } from "../../src/builders/customer-builder.js";

import {
  InMemoryCustomerRepository,
  InMemoryPlanRepository,
  InMemorySubscriptionRepository,
  InMemoryInvoiceRepository,
  InMemoryPaymentRepository,
  InMemoryWebhookEventRepository,
  InMemoryAuditEventRepository,
} from "../../src/repositories/in-memory-repositories.js";

import { MockPaymentProvider } from "../../src/payment/mock-payment-provider.js";
import { SubscriptionService } from "../../src/services/subscription-service.js";
import { WebhookService } from "../../src/services/webhook-service.js";

import type { Plan } from "../../src/domain/plan.js";

export const WEBHOOK_SECRET = "test-webhook-secret";

export function createTestEnvironment() {
  const customerRepository = new InMemoryCustomerRepository();
  const planRepository = new InMemoryPlanRepository();
  const subscriptionRepository = new InMemorySubscriptionRepository();
  const invoiceRepository = new InMemoryInvoiceRepository();
  const paymentRepository = new InMemoryPaymentRepository();
  const webhookEventRepository = new InMemoryWebhookEventRepository();
  const auditEventRepository = new InMemoryAuditEventRepository();

  const basicPlan: Plan = {
    id: "basic",
    name: "Basic",
    priceCents: 2900,
    currency: "USD",
    trialDays: 7,
  };

  const proPlan: Plan = {
    id: "pro",
    name: "Pro",
    priceCents: 4900,
    currency: "USD",
    trialDays: 14,
  };

  planRepository.save(basicPlan);
  planRepository.save(proPlan);

  const customer = new CustomerBuilder()
    .withId("cust_001")
    .withName("Test Customer")
    .withEmail("customer@example.com")
    .build();

  customerRepository.save(customer);

  const paymentProvider = new MockPaymentProvider("success");

  const subscriptionService = new SubscriptionService(
  customerRepository,
  planRepository,
  subscriptionRepository,
  invoiceRepository,
  paymentRepository,
  paymentProvider,
  auditEventRepository,
);

  const webhookService = new WebhookService(
    subscriptionRepository,
    invoiceRepository,
    paymentRepository,
    webhookEventRepository,
    auditEventRepository,
  );

  const app = createApp({
    subscriptionService,
    webhookService,
    webhookSecret: WEBHOOK_SECRET,
  });

  return {
    app,
    customerRepository,
    planRepository,
    subscriptionRepository,
    invoiceRepository,
    paymentRepository,
    webhookEventRepository,
    auditEventRepository,
    paymentProvider,
    subscriptionService,
    webhookService,
    customer,
    basicPlan,
    proPlan,
  };
}