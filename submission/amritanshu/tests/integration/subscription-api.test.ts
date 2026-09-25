import { describe, expect, it, beforeEach } from "vitest";

import {
  createTestEnvironment,
  WEBHOOK_SECRET,
} from "../fixtures/test-environment.js";

import { SubscriptionApiClient } from "../support/api-client.js";
import { WebhookSimulator } from "../support/webhook-simulator.js";
import { generateSignature } from "../../src/api/signature.js";

describe("Subscription API", () => {
  let environment: ReturnType<typeof createTestEnvironment>;
  let api: SubscriptionApiClient;
  let webhooks: WebhookSimulator;

  beforeEach(() => {
    environment = createTestEnvironment();

    api = new SubscriptionApiClient(environment.app);

    webhooks = new WebhookSimulator(
      api,
      WEBHOOK_SECRET,
    );
  });

  describe("POST /subscriptions", () => {
    it("should create a subscription successfully", async () => {
      const response = await api.createSubscription({
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
      });

      expect(response.status).toBe(201);

      expect(response.body).toMatchObject({
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
        status: "active",
      });

      expect(response.body.id).toBeDefined();
      expect(response.body.created_at).toBeDefined();
      expect(response.body.invoice).toBeDefined();
      expect(response.body.payment).toBeDefined();

      expect(response.body.invoice.amount).toBe(
        environment.proPlan.priceCents,
      );

      expect(response.body.invoice.currency).toBe("USD");

      expect(response.body.payment.status).toBe(
        "succeeded",
      );

      expect(
        environment.paymentProvider.getCalls(),
      ).toHaveLength(1);

      expect(
        environment.paymentProvider.getCalls()[0],
      ).toMatchObject({
        customerId: "cust_001",
        paymentMethodId: "pm_test_visa_4242",
        amountCents: environment.proPlan.priceCents,
        currency: "USD",
      });
    });

    it("should reject an unknown customer", async () => {
      const response = await api.createSubscription({
        customer_id: "cust_unknown",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
      });

      expect(response.status).toBe(400);

      expect(response.body.error).toContain(
        "Customer not found",
      );

      expect(
        environment.paymentProvider.getCalls(),
      ).toHaveLength(0);
    });

    it("should reject an unknown plan", async () => {
      const response = await api.createSubscription({
        customer_id: "cust_001",
        plan: "enterprise" as "basic" | "pro",
        payment_method_id: "pm_test_visa_4242",
      });

      expect(response.status).toBe(400);

      expect(response.body.error).toContain(
        "Plan not found",
      );

      expect(
        environment.paymentProvider.getCalls(),
      ).toHaveLength(0);
    });

    it("should reject a missing payment method", async () => {
      const response = await api.createSubscription({
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "",
      });

      expect(response.status).toBe(400);

      expect(response.body.error).toContain(
        "Payment method is required",
      );

      expect(
        environment.paymentProvider.getCalls(),
      ).toHaveLength(0);
    });
  });

  describe("GET /subscriptions/:id", () => {
    it("should retrieve an existing subscription", async () => {
      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      const subscriptionId = createResponse.body.id;

      const response =
        await api.getSubscription(subscriptionId);

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: subscriptionId,
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
        status: "active",
      });
    });

    it("should return 404 for an unknown subscription", async () => {
      const response =
        await api.getSubscription("sub_unknown");

      expect(response.status).toBe(404);

      expect(response.body.error).toContain(
        "Subscription not found",
      );
    });
  });

  describe("POST /subscriptions/:id/cancel", () => {
    it("should cancel an active subscription", async () => {
      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      const subscriptionId = createResponse.body.id;

      const response =
        await api.cancelSubscription(subscriptionId);

      expect(response.status).toBe(200);

      expect(response.body).toMatchObject({
        id: subscriptionId,
        status: "canceled",
      });

      expect(response.body.canceled_at).toBeDefined();

      const getResponse =
        await api.getSubscription(subscriptionId);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.status).toBe(
        "canceled",
      );
    });

    it("should reject cancellation of an already canceled subscription", async () => {
      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      const subscriptionId = createResponse.body.id;

      await api.cancelSubscription(subscriptionId);

      const response =
        await api.cancelSubscription(subscriptionId);

      expect(response.status).toBe(400);

      expect(response.body.error).toContain(
        "Invalid subscription transition",
      );
    });
  });

  describe("Webhook signature", () => {
    it("should accept a valid webhook signature", async () => {
      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      const payload = {
        event_id: "evt_test_001",
        type: "payment.refunded",
        subscription_id: createResponse.body.id,
        invoice_id: createResponse.body.invoice.id,
        amount: environment.proPlan.priceCents,
        currency: "USD",
      };

      const rawBody = JSON.stringify(payload);

      const signature = generateSignature(
        rawBody,
        WEBHOOK_SECRET,
      );

      const response =
        await api.sendWebhook(
          payload,
          signature,
        );

      expect(response.status).toBe(200);

      expect(response.body).toEqual({
        received: true,
      });
    });

    it("should reject a missing webhook signature", async () => {
      const response =
        await api.sendWebhook(
          {
            event_id: "evt_invalid_001",
            type: "payment.succeeded",
            subscription_id: "sub_unknown",
            invoice_id: "inv_unknown",
            amount: 4900,
            currency: "USD",
          },
          "",
        );

      expect(response.status).toBe(401);

      expect(response.body.error).toBe(
        "Invalid webhook signature",
      );
    });

    it("should reject an invalid webhook signature", async () => {
      const payload = {
        event_id: "evt_invalid_002",
        type: "payment.succeeded",
        subscription_id: "sub_unknown",
        invoice_id: "inv_unknown",
        amount: 4900,
        currency: "USD",
      };

      const response =
        await api.sendWebhook(
          payload,
          "invalid-signature",
        );

      expect(response.status).toBe(401);

      expect(response.body.error).toBe(
        "Invalid webhook signature",
      );
    });
  });

  describe("Webhook state changes", () => {
    it("should move a past_due subscription back to active on payment.succeeded", async () => {
      environment.paymentProvider.setOutcome(
        "decline",
      );

      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      expect(createResponse.body.status).toBe(
        "past_due",
      );

      const subscriptionId = createResponse.body.id;
      const invoiceId = createResponse.body.invoice.id;

      const webhookResponse =
        await webhooks.sendPaymentSucceeded(
          subscriptionId,
          invoiceId,
          environment.proPlan.priceCents,
          "evt_retry_success_001",
        );

      expect(webhookResponse.status).toBe(200);

      const getResponse =
        await api.getSubscription(subscriptionId);

      expect(getResponse.body.status).toBe(
        "active",
      );
    });

    it("should not regress active subscription when a late payment.failed webhook arrives", async () => {
      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      const subscriptionId = createResponse.body.id;
      const invoiceId = createResponse.body.invoice.id;

      expect(createResponse.body.status).toBe(
        "active",
      );

      const response =
        await webhooks.sendPaymentFailed(
          subscriptionId,
          invoiceId,
          environment.proPlan.priceCents,
          "evt_late_failure_001",
        );

      expect(response.status).toBe(200);

      const getResponse =
        await api.getSubscription(subscriptionId);

      expect(getResponse.body.status).toBe(
        "active",
      );
    });
  });

  describe("Webhook idempotency", () => {
    it("should process the same event only once", async () => {
      environment.paymentProvider.setOutcome(
        "decline",
      );

      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      const subscriptionId = createResponse.body.id;
      const invoiceId = createResponse.body.invoice.id;

      const firstResponse =
        await webhooks.sendPaymentSucceeded(
          subscriptionId,
          invoiceId,
          environment.proPlan.priceCents,
          "evt_duplicate_001",
        );

      const secondResponse =
        await webhooks.sendPaymentSucceeded(
          subscriptionId,
          invoiceId,
          environment.proPlan.priceCents,
          "evt_duplicate_001",
        );

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);

      const payments =
        environment.paymentRepository.findByInvoiceId(
          invoiceId,
        );

      expect(
        payments.filter(
          (payment) => payment.status === "succeeded",
        ),
      ).toHaveLength(1);

      const webhookEvent =
        environment.webhookEventRepository.findByEventId(
          "evt_duplicate_001",
        );

      expect(webhookEvent).toBeDefined();
    });
  });
 describe("Persistence and payment provider validation", () => {
    it("should persist subscription, invoice, and successful payment consistently", async () => {
      const response = await api.createSubscription({
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
      });

      expect(response.status).toBe(201);

      const subscriptionId = response.body.id;
      const invoiceId = response.body.invoice.id;
      const paymentId = response.body.payment.id;

      const subscription =
        environment.subscriptionRepository.findById(
          subscriptionId,
        );

      const invoice =
        environment.invoiceRepository.findById(
          invoiceId,
        );

      const payment =
        environment.paymentRepository.findById(
          paymentId,
        );

      expect(subscription).toBeDefined();
      expect(invoice).toBeDefined();
      expect(payment).toBeDefined();

      expect(subscription).toMatchObject({
        id: subscriptionId,
        customerId: "cust_001",
        planId: "pro",
        paymentMethodId: "pm_test_visa_4242",
        state: "active",
      });

      expect(invoice).toMatchObject({
        id: invoiceId,
        subscriptionId,
        amountCents: environment.proPlan.priceCents,
        currency: "USD",
        status: "paid",
      });

      expect(payment).toMatchObject({
        id: paymentId,
        invoiceId,
        subscriptionId,
        amountCents: environment.proPlan.priceCents,
        currency: "USD",
        status: "succeeded",
      });
    });

    it("should call the payment provider exactly once with the correct billing details", async () => {
      const response = await api.createSubscription({
        customer_id: "cust_001",
        plan: "basic",
        payment_method_id: "pm_test_visa_4242",
      });

      expect(response.status).toBe(201);

      const calls =
        environment.paymentProvider.getCalls();

      expect(calls).toHaveLength(1);

      expect(calls[0]).toMatchObject({
        customerId: "cust_001",
        paymentMethodId: "pm_test_visa_4242",
        amountCents: environment.basicPlan.priceCents,
        currency: environment.basicPlan.currency,
        idempotencyKey: response.body.invoice.id,
      });
    });

    it("should persist a failed payment when the provider declines", async () => {
      environment.paymentProvider.setOutcome(
        "decline",
      );

      const response = await api.createSubscription({
        customer_id: "cust_001",
        plan: "pro",
        payment_method_id: "pm_test_visa_4242",
      });

      expect(response.status).toBe(201);

      expect(response.body.status).toBe(
        "past_due",
      );

      expect(response.body.payment.status).toBe(
        "failed",
      );

      const invoiceId = response.body.invoice.id;
      const subscriptionId = response.body.id;
      const paymentId = response.body.payment.id;

      const invoice =
        environment.invoiceRepository.findById(
          invoiceId,
        );

      const payment =
        environment.paymentRepository.findById(
          paymentId,
        );

      const subscription =
        environment.subscriptionRepository.findById(
          subscriptionId,
        );

      expect(invoice?.status).toBe("failed");
      expect(payment?.status).toBe("failed");
      expect(subscription?.state).toBe("past_due");

      expect(
        environment.paymentProvider.getCalls(),
      ).toHaveLength(1);
    });

    it("should persist refund information without changing subscription state", async () => {
      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      const subscriptionId = createResponse.body.id;
      const invoiceId = createResponse.body.invoice.id;
      const paymentId = createResponse.body.payment.id;

      expect(createResponse.body.status).toBe(
        "active",
      );

      const webhookResponse =
        await webhooks.sendPaymentRefunded(
          subscriptionId,
          invoiceId,
          environment.proPlan.priceCents,
          "evt_refund_api_001",
        );

      expect(webhookResponse.status).toBe(200);

      const subscription =
        environment.subscriptionRepository.findById(
          subscriptionId,
        );

      const invoice =
        environment.invoiceRepository.findById(
          invoiceId,
        );

      const payment =
        environment.paymentRepository.findById(
          paymentId,
        );

      expect(subscription?.state).toBe("active");
      expect(invoice?.status).toBe("refunded");
      expect(payment?.status).toBe("refunded");
    });
  });  describe("Audit event validation", () => {
    it("should record an audit event when a subscription is canceled", async () => {
      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      expect(createResponse.status).toBe(201);

      const subscriptionId = createResponse.body.id;

      const cancelResponse =
        await api.cancelSubscription(subscriptionId);

      expect(cancelResponse.status).toBe(200);

      const auditEvents =
        environment.auditEventRepository.findBySubscriptionId(
          subscriptionId,
        );

      expect(auditEvents.length).toBeGreaterThan(0);

      const cancellationEvent =
        auditEvents[auditEvents.length - 1];

      expect(cancellationEvent).toMatchObject({
        subscriptionId,
        previousState: "active",
        nextState: "canceled",
      });

      expect(cancellationEvent.eventType).toBeDefined();
      expect(cancellationEvent.createdAt).toBeInstanceOf(
        Date,
      );
    });

    it("should record an audit event when payment succeeds after a failure", async () => {
      environment.paymentProvider.setOutcome(
        "decline",
      );

      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      expect(createResponse.status).toBe(201);
      expect(createResponse.body.status).toBe(
        "past_due",
      );

      const subscriptionId = createResponse.body.id;
      const invoiceId = createResponse.body.invoice.id;

      const beforeEvents =
        environment.auditEventRepository.findBySubscriptionId(
          subscriptionId,
        );

      const previousCount = beforeEvents.length;

      const webhookResponse =
        await webhooks.sendPaymentSucceeded(
          subscriptionId,
          invoiceId,
          environment.proPlan.priceCents,
          "evt_audit_success_001",
        );

      expect(webhookResponse.status).toBe(200);

      const auditEvents =
        environment.auditEventRepository.findBySubscriptionId(
          subscriptionId,
        );

      expect(auditEvents.length).toBeGreaterThan(
        previousCount,
      );

      const activationEvent =
        auditEvents[auditEvents.length - 1];

      expect(activationEvent).toMatchObject({
        subscriptionId,
        previousState: "past_due",
        nextState: "active",
      });

      expect(activationEvent.eventType).toBeDefined();
    });

    it("should not create duplicate audit events when the same webhook is replayed", async () => {
      environment.paymentProvider.setOutcome(
        "decline",
      );

      const createResponse =
        await api.createSubscription({
          customer_id: "cust_001",
          plan: "pro",
          payment_method_id: "pm_test_visa_4242",
        });

      const subscriptionId = createResponse.body.id;
      const invoiceId = createResponse.body.invoice.id;

      const firstResponse =
        await webhooks.sendPaymentSucceeded(
          subscriptionId,
          invoiceId,
          environment.proPlan.priceCents,
          "evt_audit_duplicate_001",
        );

      expect(firstResponse.status).toBe(200);

      const eventsAfterFirst =
        environment.auditEventRepository.findBySubscriptionId(
          subscriptionId,
        );

      const secondResponse =
        await webhooks.sendPaymentSucceeded(
          subscriptionId,
          invoiceId,
          environment.proPlan.priceCents,
          "evt_audit_duplicate_001",
        );

      expect(secondResponse.status).toBe(200);

      const eventsAfterSecond =
        environment.auditEventRepository.findBySubscriptionId(
          subscriptionId,
        );

      expect(eventsAfterSecond.length).toBe(
        eventsAfterFirst.length,
      );
    });
 
  });it("should reject a webhook with an invalid signature", async () => {
  const response = await api.sendWebhook(
    {
      event_id: "evt_invalid_signature",
      type: "payment.succeeded",
      subscription_id: "sub_001",
      invoice_id: "inv_001",
      amount: 4900,
      currency: "USD",
    },
    "invalid-signature",
  );

  expect(response.status).toBe(401);
  expect(response.body).toEqual({
    error: "Invalid webhook signature",
  });
});it("should reject a malformed webhook payload", async () => {
  const malformedPayload = {
    event_id: "evt_malformed_001",
    type: "payment.succeeded",
    subscription_id: "sub_missing",
    // invoice_id intentionally missing
    amount: 4900,
    currency: "USD",
  };

  const rawBody = JSON.stringify(malformedPayload);
  const signature = generateSignature(rawBody, WEBHOOK_SECRET);

  const response = await api.sendWebhook(
    malformedPayload,
    signature,
  );

  expect([400, 404]).toContain(response.status);
});it("should ignore payment success webhook after cancellation", async () => {
  const createResponse = await api.createSubscription({
    customer_id: "cust_001",
    plan: "pro",
    payment_method_id: "pm_test_visa_4242",
  });

  expect(createResponse.status).toBe(201);

  const subscriptionId = createResponse.body.id;
  const invoiceId = createResponse.body.invoice.id;

  const cancelResponse = await api.cancelSubscription(subscriptionId);

  expect(cancelResponse.status).toBe(200);
  expect(cancelResponse.body.status).toBe("canceled");

  const paymentCountBeforeWebhook =
    environment.paymentRepository.findBySubscriptionId(subscriptionId).length;

  const webhookResponse = await webhooks.sendPaymentSucceeded(
    subscriptionId,
    invoiceId,
    4900,
    "evt_after_cancel_001",
  );

  expect(webhookResponse.status).toBe(200);

  const getResponse = await api.getSubscription(subscriptionId);

  expect(getResponse.status).toBe(200);
  expect(getResponse.body.status).toBe("canceled");

  const paymentCountAfterWebhook =
    environment.paymentRepository.findBySubscriptionId(subscriptionId).length;

  expect(paymentCountAfterWebhook).toBe(paymentCountBeforeWebhook);
});
 });
