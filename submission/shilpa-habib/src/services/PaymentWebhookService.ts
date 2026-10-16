
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { Subscription } from "../domain/Subscription";
import { SubscriptionStateMachine } from "../domain/SubscriptionStateMachine";
import type { InMemoryBillingRepository } from "../persistence/InMemoryBillingRepository";
import type { WebhookEvent, WebhookEventType } from "../persistence/WebhookEvent";

interface PaymentWebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: "USD";
}

export class PaymentWebhookError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "PaymentWebhookError";
  }
}

export class PaymentWebhookService {
  private readonly stateMachine = new SubscriptionStateMachine();

  constructor(
    private readonly repository: InMemoryBillingRepository,
    private readonly secret: string,
  ) {}

  process(rawBody: Buffer, signature: string | undefined): {
    received: true;
    duplicate: boolean;
  } {
    if (!signature) {
      throw new PaymentWebhookError("Missing signature", 401);
    }

    const expected = createHmac("sha256", this.secret)
      .update(rawBody)
      .digest();

    let actual: Buffer;

    try {
      if (!/^[a-f0-9]{64}$/i.test(signature)) {
        throw new Error("Invalid signature format");
      }
      actual = Buffer.from(signature, "hex");
    } catch {
      throw new PaymentWebhookError("Invalid signature", 401);
    }

    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new PaymentWebhookError("Invalid signature", 401);
    }

    let payload: PaymentWebhookPayload;

    try {
      const parsed: unknown = JSON.parse(rawBody.toString("utf8"));

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("event_id" in parsed) ||
        typeof parsed.event_id !== "string" ||
        !parsed.event_id.trim() ||
        !("type" in parsed) ||
        !["payment.succeeded", "payment.failed", "payment.refunded"].includes(
          String(parsed.type),
        ) ||
        !("subscription_id" in parsed) ||
        typeof parsed.subscription_id !== "string" ||
        !("invoice_id" in parsed) ||
        typeof parsed.invoice_id !== "string" ||
        !("amount" in parsed) ||
        typeof parsed.amount !== "number" ||
        !Number.isSafeInteger(parsed.amount) ||
        parsed.amount < 0 ||
        !("currency" in parsed) ||
        parsed.currency !== "USD"
      ) {
        throw new Error("Invalid payload");
      }

      payload = parsed as PaymentWebhookPayload;
    } catch {
      throw new PaymentWebhookError("Malformed webhook payload", 400);
    }

    const existing = this.repository.getWebhookEvent(payload.event_id);

    if (existing) {
      this.repository.saveWebhookEvent({
        ...existing,
        duplicate: true,
      });

      return { received: true, duplicate: true };
    }

    const subscription = this.repository.getSubscription(
      payload.subscription_id,
    );
    const invoice = this.repository.getInvoice(payload.invoice_id);

    if (
      !subscription ||
      !invoice ||
      invoice.subscriptionId !== subscription.id ||
      invoice.customerId !== subscription.customerId
    ) {
      throw new PaymentWebhookError(
        "Subscription or invoice not found",
        404,
      );
    }

    if (
      invoice.amountInCents !== payload.amount ||
      invoice.currency !== payload.currency
    ) {
      throw new PaymentWebhookError("Payment details do not match invoice", 400);
    }

    const event: WebhookEvent = {
      eventId: payload.event_id,
      type: payload.type,
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      receivedAt: new Date().toISOString(),
      processed: false,
      duplicate: false,
      ignoredReason: null,
    };

    // A late failure must never undo an already successful payment.
    if (
      payload.type === "payment.failed" &&
      invoice.status === "succeeded"
    ) {
      event.ignoredReason = "Invoice already succeeded; stale failure ignored";
      this.repository.saveWebhookEvent(event);
      return { received: true, duplicate: false };
    }

    if (payload.type === "payment.refunded") {
      event.ignoredReason = "Refund business logic is not implemented";
      this.repository.saveWebhookEvent(event);
      return { received: true, duplicate: false };
    }

    if (invoice.status === "succeeded" || invoice.status === "failed") {
      event.ignoredReason = `Invoice is already ${invoice.status}`;
      this.repository.saveWebhookEvent(event);
      return { received: true, duplicate: false };
    }

    if (payload.type === "payment.succeeded") {
      invoice.status = "succeeded";
      invoice.providerReference ??= `webhook_${payload.event_id}`;

      if (subscription.status !== "canceled" &&
          subscription.status !== "active") {
        const previousStatus = subscription.status;

        try {
          subscription.status = this.stateMachine.transition(
            previousStatus,
            "payment_succeeded",
          );
          this.saveSubscriptionAndAudit(
            subscription,
            "payment_succeeded",
            previousStatus,
          );
        } catch {
          event.ignoredReason = "Subscription cannot transition on payment success";
        }
      }
    } else {
      invoice.status = "failed";

      if (
        subscription.status === "trialing" ||
        subscription.status === "active"
      ) {
        const previousStatus = subscription.status;

        subscription.status = this.stateMachine.transition(
          previousStatus,
          "payment_failed",
        );
        this.saveSubscriptionAndAudit(
          subscription,
          "payment_failed",
          previousStatus,
        );
      }
    }

    invoice.updatedAt = new Date().toISOString();
    this.repository.saveInvoice(invoice);

    event.processed = event.ignoredReason === null;
    this.repository.saveWebhookEvent(event);

    return { received: true, duplicate: false };
  }

  private saveSubscriptionAndAudit(
    subscription: Subscription,
    reason: string,
    previousStatus: Subscription["status"],
  ): void {
    this.repository.saveSubscription(subscription);
    this.repository.saveAuditEvent({
      id: `audit_${randomUUID()}`,
      subscriptionId: subscription.id,
      fromStatus: previousStatus,
      toStatus: subscription.status,
      reason,
      occurredAt: new Date().toISOString(),
    });
  }
}
