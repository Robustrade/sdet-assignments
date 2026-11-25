
import { Invoice } from "../../src/domain/Invoice";
import { SubscriptionStateMachine } from "../../src/domain/SubscriptionStateMachine";
import { InMemorySubscriptionRepository } from "../../src/repositories/InMemorySubscriptionRepository";
import { InMemoryInvoiceRepository } from "../../src/repositories/InMemoryInvoiceRepository";
import { InMemoryWebhookEventRepository } from "../../src/repositories/InMemoryWebhookEventRepository";
import { SubscriptionService } from "../../src/services/SubscriptionService";
import { WebhookService } from "../../src/services/WebhookService";
import { WebhookSignature } from "../../src/services/WebhookSignature";

describe("Webhook service integration", () => {
    let webhookService: WebhookService;
    let subscriptionService: SubscriptionService;
    let invoiceRepository: InMemoryInvoiceRepository;
    let eventRepository: InMemoryWebhookEventRepository;
    let signatureVerifier: WebhookSignature;
    let subscriptionId: string;
    let invoice: Invoice;

    beforeEach(async () => {
        invoiceRepository = new InMemoryInvoiceRepository();

        eventRepository =
            new InMemoryWebhookEventRepository();

        subscriptionService = new SubscriptionService(
            new InMemorySubscriptionRepository(),
            new SubscriptionStateMachine(),
            undefined,
            undefined,
            invoiceRepository
        );

        signatureVerifier = new WebhookSignature(
            "test_secret"
        );

        webhookService = new WebhookService(
            invoiceRepository,
            eventRepository,
            subscriptionService,
            signatureVerifier
        );

        const subscription =
            await subscriptionService.createSubscription(
                "cust_001",
                "plan_basic"
            );

        subscriptionId = subscription.id;

        invoice = {
            id: "inv_001",
            subscriptionId,
            customerId: "cust_001",
            amount: 1900,
            currency: "USD",
            status: "pending",
            idempotencyKey: "billing_001",
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await invoiceRepository.save(invoice);
    });

    function createPayload(
        overrides: Record<string, unknown> = {}
    ): string {
        return JSON.stringify({
            event_id: "evt_001",
            type: "payment.succeeded",
            subscription_id: subscriptionId,
            invoice_id: invoice.id,
            amount: invoice.amount,
            currency: invoice.currency,
            ...overrides
        });
    }

    async function sendEvent(
        overrides: Record<string, unknown> = {}
    ) {
        const payload = createPayload(overrides);

        return webhookService.process(
            payload,
            signatureVerifier.sign(payload)
        );
    }
    async function activateWithSuccessfulPayment() {
        await invoiceRepository.save({
            ...invoice,
            id: "inv_previous_paid",
            status: "paid",
            idempotencyKey: "billing_previous",
            transactionId: "txn_previous_success"
        });

        await subscriptionService.changeStatus(
            subscriptionId,
            "active"
        );
    }

    test("processes a successful payment", async () => {
        expect(await sendEvent()).toBe("processed");

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(saved?.status).toBe("paid");
    });

    test("activates subscription after successful payment", async () => {
        await sendEvent();

        const subscription =
            await subscriptionService.getSubscription(
                subscriptionId
            );

        expect(subscription?.status).toBe("active");
    });

    test("processes a failed payment", async () => {
        await activateWithSuccessfulPayment();

        expect(
            await sendEvent({ type: "payment.failed" })
        ).toBe("processed");

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(saved?.status).toBe("failed");
    });

    test("moves subscription to past due after failure", async () => {
        await activateWithSuccessfulPayment();

        await sendEvent({ type: "payment.failed" });

        const subscription =
            await subscriptionService.getSubscription(
                subscriptionId
            );

        expect(subscription?.status).toBe("past_due");
    });

    test("refunds a paid invoice", async () => {
        await sendEvent();

        expect(
            await sendEvent({
                event_id: "evt_002",
                type: "payment.refunded"
            })
        ).toBe("processed");

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(saved?.status).toBe("refunded");
    });

    test("refund does not change subscription status", async () => {
        await sendEvent();

        await sendEvent({
            event_id: "evt_002",
            type: "payment.refunded"
        });

        const subscription =
            await subscriptionService.getSubscription(
                subscriptionId
            );

        expect(subscription?.status).toBe("active");
    });

    test("rejects refund of an unpaid invoice", async () => {
        await expect(
            sendEvent({ type: "payment.refunded" })
        ).rejects.toThrow(
            "Only paid invoices can be refunded"
        );
    });

    test("ignores duplicate event IDs", async () => {
        expect(await sendEvent()).toBe("processed");

        expect(await sendEvent()).toBe("duplicate");

        expect(await eventRepository.count()).toBe(1);
    });

    test("handles simultaneous duplicate events", async () => {
        const results = await Promise.all([
            sendEvent(),
            sendEvent(),
            sendEvent(),
            sendEvent(),
            sendEvent()
        ]);

        expect(
            results.filter(result => result === "processed")
        ).toHaveLength(1);

        expect(
            results.filter(result => result === "duplicate")
        ).toHaveLength(4);

        expect(await eventRepository.count()).toBe(1);
    });

    test("ignores stale failure after successful payment", async () => {
        await sendEvent();

        expect(
            await sendEvent({
                event_id: "evt_002",
                type: "payment.failed"
            })
        ).toBe("ignored");

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(saved?.status).toBe("paid");

        const subscription =
            await subscriptionService.getSubscription(
                subscriptionId
            );

        expect(subscription?.status).toBe("active");
    });

    test("ignores successful payment after refund", async () => {
        await sendEvent();

        await sendEvent({
            event_id: "evt_002",
            type: "payment.refunded"
        });

        expect(
            await sendEvent({ event_id: "evt_003" })
        ).toBe("ignored");

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(saved?.status).toBe("refunded");
    });

    test("rejects invalid webhook signature", async () => {
        await expect(
            webhookService.process(
                createPayload(),
                "invalid_signature"
            )
        ).rejects.toThrow("Invalid webhook signature");

        expect(await eventRepository.count()).toBe(0);
    });

    test("rejects malformed JSON payload", async () => {
        const payload = "{invalid_json";

        await expect(
            webhookService.process(
                payload,
                signatureVerifier.sign(payload)
            )
        ).rejects.toThrow("Invalid webhook payload");
    });

    test("rejects unsupported event types", async () => {
        await expect(
            sendEvent({ type: "unknown.event" })
        ).rejects.toThrow("Unsupported webhook event");
    });

    test("rejects missing event ID", async () => {
        await expect(
            sendEvent({ event_id: "" })
        ).rejects.toThrow("Invalid webhook event");
    });

    test("rejects unknown invoice", async () => {
        await expect(
            sendEvent({ invoice_id: "unknown_invoice" })
        ).rejects.toThrow("Invoice not found");
    });

    test("rejects mismatched subscription ID", async () => {
        await expect(
            sendEvent({ subscription_id: "wrong_subscription" })
        ).rejects.toThrow("Subscription mismatch");
    });

    test("rejects incorrect payment amount", async () => {
        await expect(
            sendEvent({ amount: 9999 })
        ).rejects.toThrow(
            "Invoice amount or currency mismatch"
        );
    });

    test("rejects incorrect currency", async () => {
        await expect(
            sendEvent({ currency: "EUR" })
        ).rejects.toThrow(
            "Invoice amount or currency mismatch"
        );
    });

    test("rejected events do not modify invoice", async () => {
        await expect(
            sendEvent({ amount: 9999 })
        ).rejects.toThrow();

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(saved).toEqual(invoice);
        expect(await eventRepository.count()).toBe(0);
    });
    test("successful payment does not reactivate a canceled subscription", async () => {
        await subscriptionService.changeStatus(
            subscriptionId,
            "canceled"
        );

        expect(await sendEvent()).toBe("processed");

        const subscription =
            await subscriptionService.getSubscription(subscriptionId);

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(subscription?.status).toBe("canceled");
        expect(saved?.status).toBe("paid");
        expect(await eventRepository.count()).toBe(1);
    });

    test("failed payment does not change canceled subscription to past due", async () => {
        await subscriptionService.changeStatus(
            subscriptionId,
            "canceled"
        );

        expect(
            await sendEvent({ type: "payment.failed" })
        ).toBe("processed");

        const subscription =
            await subscriptionService.getSubscription(subscriptionId);

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(subscription?.status).toBe("canceled");
        expect(saved?.status).toBe("failed");
        expect(await eventRepository.count()).toBe(1);
    });

    test("refund preserves canceled subscription status", async () => {
        await sendEvent();

        await subscriptionService.changeStatus(
            subscriptionId,
            "canceled"
        );

        expect(
            await sendEvent({
                event_id: "evt_002",
                type: "payment.refunded"
            })
        ).toBe("processed");

        const subscription =
            await subscriptionService.getSubscription(subscriptionId);

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(subscription?.status).toBe("canceled");
        expect(saved?.status).toBe("refunded");
        expect(await eventRepository.count()).toBe(2);
    });

    test("duplicate payment events do not reactivate canceled subscription", async () => {
        await subscriptionService.changeStatus(
            subscriptionId,
            "canceled"
        );

        expect(await sendEvent()).toBe("processed");
        expect(await sendEvent()).toBe("duplicate");

        const subscription =
            await subscriptionService.getSubscription(subscriptionId);

        const saved =
            await invoiceRepository.findById(invoice.id);

        expect(subscription?.status).toBe("canceled");
        expect(saved?.status).toBe("paid");
        expect(await eventRepository.count()).toBe(1);
    });
    test("records successfully processed webhook in audit history", async () => {
        expect(await sendEvent()).toBe("processed");

        const history = await eventRepository.findAuditHistory();

        expect(history).toHaveLength(1);

        expect(history[0]).toMatchObject({
            eventId: "evt_001",
            eventType: "payment.succeeded",
            subscriptionId,
            invoiceId: invoice.id,
            outcome: "processed",
            processedAt: expect.any(Date)
        });
    });

    test("records duplicate webhook deliveries in audit history", async () => {
        expect(await sendEvent()).toBe("processed");
        expect(await sendEvent()).toBe("duplicate");
        expect(await sendEvent()).toBe("duplicate");

        const history = await eventRepository.findAuditHistory();

        expect(history).toHaveLength(3);

        expect(history.map(record => record.eventId)).toEqual([
            "evt_001",
            "evt_001",
            "evt_001"
        ]);

        expect(history.map(record => record.outcome)).toEqual([
            "processed",
            "duplicate",
            "duplicate"
        ]);

        expect(await eventRepository.count()).toBe(1);
    });

    test("records ignored webhook events in audit history", async () => {
        expect(await sendEvent()).toBe("processed");

        expect(
            await sendEvent({
                event_id: "evt_002",
                type: "payment.failed"
            })
        ).toBe("ignored");

        const history = await eventRepository.findAuditHistory();

        expect(history).toHaveLength(2);

        expect(history[1]).toMatchObject({
            eventId: "evt_002",
            eventType: "payment.failed",
            subscriptionId,
            invoiceId: invoice.id,
            outcome: "ignored"
        });

        const saved = await invoiceRepository.findById(invoice.id);

        expect(saved?.status).toBe("paid");
        expect(await eventRepository.count()).toBe(2);
    });

    test("records concurrent webhook deliveries individually", async () => {
        await Promise.all([
            sendEvent(),
            sendEvent(),
            sendEvent(),
            sendEvent(),
            sendEvent()
        ]);

        const history = await eventRepository.findAuditHistory();

        expect(history).toHaveLength(5);

        expect(
            history.filter(record => record.outcome === "processed")
        ).toHaveLength(1);

        expect(
            history.filter(record => record.outcome === "duplicate")
        ).toHaveLength(4);

        expect(await eventRepository.count()).toBe(1);
    });
    test("records audit timestamp within processing time", async () => {
        const before = Date.now();

        expect(await sendEvent()).toBe("processed");

        const after = Date.now();

        const history = await eventRepository.findAuditHistory();

        expect(history).toHaveLength(1);

        const timestamp = history[0].processedAt.getTime();

        expect(timestamp).toBeGreaterThanOrEqual(before);
        expect(timestamp).toBeLessThanOrEqual(after);
    });
    test("preserves chronological audit timestamp order", async () => {
        expect(await sendEvent()).toBe("processed");
        expect(await sendEvent()).toBe("duplicate");
        expect(await sendEvent()).toBe("duplicate");

        const history = await eventRepository.findAuditHistory();

        expect(history).toHaveLength(3);

        for (let i = 1; i < history.length; i++) {
            expect(
                history[i].processedAt.getTime()
            ).toBeGreaterThanOrEqual(
                history[i - 1].processedAt.getTime()
            );
        }
    });
    test.each([
        { invoice_id: "unknown_invoice" },
        { subscription_id: "unknown_subscription" },
        { currency: "EUR" }
    ])("does not audit rejected webhook: %j", async (overrides) => {
        const before = await invoiceRepository.findById(
            invoice.id
        );

        await expect(
            sendEvent(overrides)
        ).rejects.toThrow();

        expect(
            await eventRepository.findAuditHistory()
        ).toHaveLength(0);

        expect(await eventRepository.count()).toBe(0);

        const after = await invoiceRepository.findById(
            invoice.id
        );

        expect(after).toEqual(before);
    });
test("persists a successful webhook invoice only once", async () => {
  const saveSpy = jest.spyOn(invoiceRepository, "save");

  expect(await sendEvent()).toBe("processed");

  expect(saveSpy).toHaveBeenCalledTimes(1);

  const saved = await invoiceRepository.findById(
    invoice.id
  );

  expect(saved?.status).toBe("paid");
});
test("does not activate subscription when invoice persistence fails", async () => {
  jest.spyOn(invoiceRepository, "save")
    .mockRejectedValueOnce(
      new Error("Invoice persistence failed")
    );

  await expect(sendEvent()).rejects.toThrow(
    "Invoice persistence failed"
  );

  const subscription =
    await subscriptionService.getSubscription(
      subscriptionId
    );

  const saved = await invoiceRepository.findById(
    invoice.id
  );

  expect(subscription?.status).toBe("trialing");
  expect(saved?.status).toBe("pending");
  expect(await eventRepository.count()).toBe(0);
});
test("recovers subscription activation when a failed webhook is redelivered", async () => {
  jest.spyOn(subscriptionService, "changeStatus")
    .mockRejectedValueOnce(
      new Error("Subscription persistence failed")
    );

  await expect(sendEvent()).rejects.toThrow(
    "Subscription persistence failed"
  );

  const beforeRetry =
    await subscriptionService.getSubscription(
      subscriptionId
    );

  expect(beforeRetry?.status).toBe("trialing");
  expect(await eventRepository.count()).toBe(0);

  const paidInvoice =
    await invoiceRepository.findById(invoice.id);

  expect(paidInvoice?.status).toBe("paid");

  expect(await sendEvent()).toBe("processed");

  const afterRetry =
    await subscriptionService.getSubscription(
      subscriptionId
    );

  expect(afterRetry?.status).toBe("active");
  expect(await eventRepository.count()).toBe(1);

  expect(await sendEvent()).toBe("duplicate");
});
test("ignores stale successful payment after a newer payment failure", async () => {
  expect(await sendEvent()).toBe("processed");

  const recurringInvoice: Invoice = {
    ...invoice,
    id: "inv_recurring",
    status: "pending",
    idempotencyKey: "billing_recurring",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  await invoiceRepository.save(recurringInvoice);

  expect(
    await sendEvent({
      event_id: "evt_recurring_failure",
      invoice_id: recurringInvoice.id,
      type: "payment.failed"
    })
  ).toBe("processed");

  const before =
    await subscriptionService.getSubscription(
      subscriptionId
    );

  expect(before?.status).toBe("past_due");

  expect(
    await sendEvent({
      event_id: "evt_stale_success",
      invoice_id: invoice.id,
      type: "payment.succeeded"
    })
  ).toBe("ignored");

  const after =
    await subscriptionService.getSubscription(
      subscriptionId
    );

  expect(after?.status).toBe("past_due");

  expect(
    await invoiceRepository.findAll()
  ).toHaveLength(2);
});
});
