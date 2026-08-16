import { createApp } from "../../src/http/app";

import { InMemorySubscriptionRepository } from "../../src/repositories/in-memory.repository";

import {
  FakePaymentProvider,
  FakeProviderOutcome,
} from "../../src/providers/fake-payment-provider";

import { SubscriptionStateMachine } from "../../src/domain/subscription";

import { ChargeResult } from "../../src/providers/payment-provider";

export const WEBHOOK_SECRET = "test-webhook-secret";

export function createTestApp(
  paymentResult: FakeProviderOutcome | ChargeResult = {
    success: true,
    reference: "pay_test",
  },
) {
  const repository = new InMemorySubscriptionRepository();

  const paymentProvider = new FakePaymentProvider(paymentResult);

  const stateMachine = new SubscriptionStateMachine();

  const app = createApp({
    repository,
    paymentProvider,
    stateMachine,
    webhookSecret: WEBHOOK_SECRET,
  });

  return {
    app,
    repository,
    paymentProvider,
    stateMachine,
  };
}
