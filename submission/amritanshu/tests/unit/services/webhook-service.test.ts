import { describe, expect, it } from "vitest";

import {
  InMemorySubscriptionRepository,
  InMemoryInvoiceRepository,
  InMemoryPaymentRepository,
  InMemoryWebhookEventRepository,
  InMemoryAuditEventRepository,
} from "../../../src/repositories/in-memory-repositories.js";

import { WebhookService } from "../../../src/services/webhook-service.js";
import { SubscriptionBuilder } from "../../../src/builders/subscription-builder.js";
import { WebhookPayloadBuilder } from "../../../src/builders/webhook-payload-builder.js";

describe("WebhookService", () => {
  function createService() {
    const subscriptionRepository =
      new InMemorySubscriptionRepository();

    const invoiceRepository =
      new InMemoryInvoiceRepository();

    const paymentRepository =
      new InMemoryPaymentRepository();

    const webhookEventRepository =
      new InMemoryWebhookEventRepository();

    const auditEventRepository =
      new InMemoryAuditEventRepository();

    const service = new WebhookService(
      subscriptionRepository,
      invoiceRepository,
      paymentRepository,
      webhookEventRepository,
      auditEventRepository,
    );

    return {
      subscriptionRepository,
      invoiceRepository,
      paymentRepository,
      webhookEventRepository,
      auditEventRepository,
      service,
    };
  }

  function seedSubscription(
    subscriptionRepository: InMemorySubscriptionRepository,
    state: "trialing" | "active" | "past_due" | "canceled" = "trialing",
  ) {
    const subscription = new SubscriptionBuilder()
      .withState(state)
      .build();

    subscriptionRepository.save(subscription);

    return subscription;
  }

  function seedInvoice(
    invoiceRepository: InMemoryInvoiceRepository,
    subscriptionId: string,
  ) {
    const invoice = {
      id: "inv_001",
      subscriptionId,
      amountCents: 4900,
      currency: "USD",
      status: "pending" as const,
      createdAt: new Date(),
    };

    invoiceRepository.save(invoice);

    return invoice;
  }

  it("should process payment.succeeded and move trialing to active", () => {
    const {
      subscriptionRepository,
      invoiceRepository,
      paymentRepository,
      service,
    } = createService();

    const subscription = seedSubscription(subscriptionRepository);
    const invoice = seedInvoice(
      invoiceRepository,
      subscription.id,
    );

    const event = new WebhookPayloadBuilder()
      .withEventId("evt_success_001")
      .withType("payment.succeeded")
      .withSubscriptionId(subscription.id)
      .withInvoiceId(invoice.id)
      .build();

    service.process(event);

    expect(
      subscriptionRepository.findById(subscription.id)?.state,
    ).toBe("active");

    expect(
      paymentRepository.findByInvoiceId(invoice.id),
    ).toHaveLength(1);

    expect(
      paymentRepository.findByInvoiceId(invoice.id)[0].status,
    ).toBe("succeeded");
  });

  it("should process payment.failed and move trialing to past_due", () => {
    const {
      subscriptionRepository,
      invoiceRepository,
      paymentRepository,
      service,
    } = createService();

    const subscription = seedSubscription(subscriptionRepository);
    const invoice = seedInvoice(
      invoiceRepository,
      subscription.id,
    );

    const event = new WebhookPayloadBuilder()
      .withEventId("evt_failed_001")
      .withType("payment.failed")
      .withSubscriptionId(subscription.id)
      .withInvoiceId(invoice.id)
      .build();

    service.process(event);

    expect(
      subscriptionRepository.findById(subscription.id)?.state,
    ).toBe("past_due");

    expect(
      paymentRepository.findByInvoiceId(invoice.id),
    ).toHaveLength(1);

    expect(
      paymentRepository.findByInvoiceId(invoice.id)[0].status,
    ).toBe("failed");
  });

  it("should process the same event_id only once", () => {
    const {
      subscriptionRepository,
      invoiceRepository,
      paymentRepository,
      webhookEventRepository,
      service,
    } = createService();

    const subscription = seedSubscription(subscriptionRepository);
    const invoice = seedInvoice(
      invoiceRepository,
      subscription.id,
    );

    const event = new WebhookPayloadBuilder()
      .withEventId("evt_duplicate_001")
      .withType("payment.succeeded")
      .withSubscriptionId(subscription.id)
      .withInvoiceId(invoice.id)
      .build();

    service.process(event);
    service.process(event);

    expect(
      paymentRepository.findByInvoiceId(invoice.id),
    ).toHaveLength(1);

    expect(
      webhookEventRepository.findByEventId(event.eventId),
    ).toBeDefined();

    expect(
      subscriptionRepository.findById(subscription.id)?.state,
    ).toBe("active");
  });

  it("should not regress active after a late failure for an already successful invoice", () => {
    const {
      subscriptionRepository,
      invoiceRepository,
      paymentRepository,
      service,
    } = createService();

    const subscription = seedSubscription(
      subscriptionRepository,
      "trialing",
    );

    const invoice = seedInvoice(
      invoiceRepository,
      subscription.id,
    );

    const successEvent = new WebhookPayloadBuilder()
      .withEventId("evt_success_002")
      .withType("payment.succeeded")
      .withSubscriptionId(subscription.id)
      .withInvoiceId(invoice.id)
      .build();

    const failureEvent = new WebhookPayloadBuilder()
      .withEventId("evt_late_failure_001")
      .withType("payment.failed")
      .withSubscriptionId(subscription.id)
      .withInvoiceId(invoice.id)
      .build();

    service.process(successEvent);
    service.process(failureEvent);

    expect(
      subscriptionRepository.findById(subscription.id)?.state,
    ).toBe("active");

    expect(
      paymentRepository.findByInvoiceId(invoice.id),
    ).toHaveLength(1);
  });

  it("should process payment.refunded without changing subscription state", () => {
    const {
      subscriptionRepository,
      invoiceRepository,
      paymentRepository,
      service,
    } = createService();

    const subscription = seedSubscription(
      subscriptionRepository,
      "active",
    );

    const invoice = seedInvoice(
      invoiceRepository,
      subscription.id,
    );

    paymentRepository.save({
      id: "pay_001",
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      amountCents: 4900,
      currency: "USD",
      status: "succeeded",
      providerReference: "ref_001",
      createdAt: new Date(),
    });

    const event = new WebhookPayloadBuilder()
      .withEventId("evt_refund_001")
      .withType("payment.refunded")
      .withSubscriptionId(subscription.id)
      .withInvoiceId(invoice.id)
      .build();

    service.process(event);

    expect(
      subscriptionRepository.findById(subscription.id)?.state,
    ).toBe("active");

    expect(
      paymentRepository.findByInvoiceId(invoice.id)[0].status,
    ).toBe("refunded");

    expect(
      invoiceRepository.findById(invoice.id)?.status,
    ).toBe("refunded");
  });
});