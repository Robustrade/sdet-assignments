import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/api/app";
import { SubscriptionService } from "../../src/application/subscription-service";
import { WebhookService } from "../../src/application/webhook-service";

import { TestDatabase } from "../../src/infrastructure/database";
import { CustomerRepository } from "../../src/infrastructure/customer-repository";
import { SubscriptionRepository } from "../../src/infrastructure/subscription-repository";
import { InvoiceRepository } from "../../src/infrastructure/invoice-repository";
import { AuditRepository } from "../../src/infrastructure/audit-repository";
import { WebhookEventRepository } from "../../src/infrastructure/webhook-event-repository";

import { FakePaymentProvider } from "../support/fake-payment-provider";

const SECRET = "test_webhook_secret";
const FIXED_DATE = "2026-11-13T10:00:00.000Z";

function signPayload(rawBody: string): string {
  return createHmac("sha256", SECRET)
    .update(Buffer.from(rawBody))
    .digest("hex");
}

async function setup() {
  const database = await TestDatabase.create();

  const customerRepository = new CustomerRepository(database);
  const subscriptionRepository = new SubscriptionRepository(database);
  const invoiceRepository = new InvoiceRepository(database);
  const auditRepository = new AuditRepository(database);
  const webhookEventRepository = new WebhookEventRepository(database);

  const provider = new FakePaymentProvider();

  customerRepository.save({
    id: "cust_001",
    name: "Ankit Kumar"
  });

  const subscriptionService = new SubscriptionService({
    customerRepository,
    subscriptionRepository,
    invoiceRepository,
    auditRepository,
    paymentProvider: provider,
    now: () => new Date(FIXED_DATE)
  });

  const webhookService = new WebhookService({
    subscriptionRepository,
    invoiceRepository,
    webhookEventRepository,
    auditRepository,
    webhookSecret: SECRET,
    now: () => new Date(FIXED_DATE)
  });

  const app = createApp({
    subscriptionService,
    subscriptionRepository,
    webhookService
  });

  async function createTrialAndInvoice() {
    const subscription = await subscriptionService.createSubscription({
      customerId: "cust_001",
      plan: "basic",
      paymentMethodId: "pm_test_visa_4242"
    });

    const invoice = {
      id: "inv_001",
      subscriptionId: subscription.id,
      amount: 1900,
      currency: "USD",
      status: "pending" as const,
      idempotencyKey: `${subscription.id}_trial_invoice`,
      createdAt: FIXED_DATE
    };

    invoiceRepository.save(invoice);

    return { subscription, invoice };
  }

  async function sendEvent(payload: Record<string, unknown>) {
    const rawBody = JSON.stringify(payload);

    return request(app)
      .post("/webhooks/payment-provider")
      .set("Content-Type", "application/json")
      .set("X-Provider-Signature", signPayload(rawBody))
      .send(rawBody);
  }

  function event(
    eventId: string,
    type: string,
    subscriptionId: string
  ) {
    return {
      event_id: eventId,
      type,
      subscription_id: subscriptionId,
      invoice_id: "inv_001",
      amount: 1900,
      currency: "USD"
    };
  }

  return {
    database,
    app,
    subscriptionService,
    subscriptionRepository,
    invoiceRepository,
    auditRepository,
    webhookEventRepository,
    createTrialAndInvoice,
    sendEvent,
    event
  };
}

describe("Payment Webhook Processing", () => {
  it("verifies a valid signature and activates a subscription", async () => {
    const context = await setup();

    try {
      const { subscription, invoice } =
        await context.createTrialAndInvoice();

      const response = await context.sendEvent(
        context.event(
          "evt_success_001",
          "payment.succeeded",
          subscription.id
        )
      );

      expect(response.status).toBe(200);
      expect(response.body.outcome).toBe("processed");

      expect(
        context.subscriptionRepository.findById(subscription.id)?.status
      ).toBe("active");

      expect(
        context.invoiceRepository.findById(invoice.id)?.status
      ).toBe("succeeded");

      expect(
        context.webhookEventRepository.findByEventId("evt_success_001")?.processed
      ).toBe(true);
    } finally {
      context.database.close();
    }
  });

  it("rejects an invalid webhook signature", async () => {
    const context = await setup();

    try {
      const { subscription } =
        await context.createTrialAndInvoice();

      const rawBody = JSON.stringify(
        context.event(
          "evt_forged_001",
          "payment.succeeded",
          subscription.id
        )
      );

      const response = await request(context.app)
        .post("/webhooks/payment-provider")
        .set("Content-Type", "application/json")
        .set("X-Provider-Signature", "invalid-signature")
        .send(rawBody);

      expect(response.status).toBe(401);

      expect(
        context.subscriptionRepository.findById(subscription.id)?.status
      ).toBe("trialing");

      expect(
        context.webhookEventRepository.findByEventId("evt_forged_001")
      ).toBeUndefined();
    } finally {
      context.database.close();
    }
  });

  it("processes a duplicate event only once", async () => {
    const context = await setup();

    try {
      const { subscription } =
        await context.createTrialAndInvoice();

      const payload = context.event(
        "evt_duplicate_001",
        "payment.succeeded",
        subscription.id
      );

      const first = await context.sendEvent(payload);
      expect(first.status).toBe(200);
      expect(first.body.duplicate).toBe(false);

      const auditCountBefore =
        context.database.get<{ total: number }>(
          "SELECT COUNT(*) AS total FROM audit_events"
        )?.total;

      const second = await context.sendEvent(payload);

      expect(second.status).toBe(200);
      expect(second.body.duplicate).toBe(true);

      const auditCountAfter =
        context.database.get<{ total: number }>(
          "SELECT COUNT(*) AS total FROM audit_events"
        )?.total;

      expect(auditCountAfter).toBe(auditCountBefore);

      expect(
        context.webhookEventRepository
          .findByEventId("evt_duplicate_001")?.deliveryCount
      ).toBe(2);

      expect(
        context.subscriptionRepository.findById(subscription.id)?.status
      ).toBe("active");
    } finally {
      context.database.close();
    }
  });

  it("does not regress a successful invoice when a failure arrives later", async () => {
    const context = await setup();

    try {
      const { subscription, invoice } =
        await context.createTrialAndInvoice();

      const success = await context.sendEvent(
        context.event(
          "evt_order_success",
          "payment.succeeded",
          subscription.id
        )
      );

      expect(success.status).toBe(200);

      const failure = await context.sendEvent(
        context.event(
          "evt_order_failure",
          "payment.failed",
          subscription.id
        )
      );

      expect(failure.status).toBe(200);
      expect(failure.body.outcome).toBe("ignored");

      expect(
        context.subscriptionRepository.findById(subscription.id)?.status
      ).toBe("active");

      expect(
        context.invoiceRepository.findById(invoice.id)?.status
      ).toBe("succeeded");
    } finally {
      context.database.close();
    }
  });

  it("never reactivates a canceled subscription through a webhook", async () => {
    const context = await setup();

    try {
      const { subscription } =
        await context.createTrialAndInvoice();

      context.subscriptionService.cancelSubscription(subscription.id);

      const response = await context.sendEvent(
        context.event(
          "evt_after_cancel",
          "payment.succeeded",
          subscription.id
        )
      );

      expect(response.status).toBe(200);
      expect(response.body.outcome).toBe("ignored");

      expect(
        context.subscriptionRepository.findById(subscription.id)?.status
      ).toBe("canceled");
    } finally {
      context.database.close();
    }
  });

  it("records a refund without changing the subscription lifecycle state", async () => {
    const context = await setup();

    try {
      const { subscription, invoice } =
        await context.createTrialAndInvoice();

      await context.sendEvent(
        context.event(
          "evt_refund_success",
          "payment.succeeded",
          subscription.id
        )
      );

      const refund = await context.sendEvent(
        context.event(
          "evt_refund_001",
          "payment.refunded",
          subscription.id
        )
      );

      expect(refund.status).toBe(200);

      expect(
        context.invoiceRepository.findById(invoice.id)?.status
      ).toBe("refunded");

      expect(
        context.subscriptionRepository.findById(subscription.id)?.status
      ).toBe("active");
    } finally {
      context.database.close();
    }
  });

  it("rejects malformed JSON even when the signature is valid", async () => {
    const context = await setup();

    try {
      const rawBody = "this is not valid JSON";

      const response = await request(context.app)
        .post("/webhooks/payment-provider")
        .set("Content-Type", "application/json")
        .set("X-Provider-Signature", signPayload(rawBody))
        .send(rawBody);

      expect(response.status).toBe(400);
    } finally {
      context.database.close();
    }
  });
});