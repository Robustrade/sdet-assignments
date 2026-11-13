import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { SubscriptionStateMachine } from "../domain/subscription-state-machine";
import type { SubscriptionStatus } from "../domain/subscription-state-machine";
import { SubscriptionRepository } from "../infrastructure/subscription-repository";
import { InvoiceRepository } from "../infrastructure/invoice-repository";
import { WebhookEventRepository } from "../infrastructure/webhook-event-repository";
import { AuditRepository } from "../infrastructure/audit-repository";

export interface WebhookPayload {
  event_id: string;
  type: "payment.succeeded" | "payment.failed" | "payment.refunded";
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export class WebhookProcessingError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "WebhookProcessingError";
  }
}

interface WebhookServiceDependencies {
  subscriptionRepository: SubscriptionRepository;
  invoiceRepository: InvoiceRepository;
  webhookEventRepository: WebhookEventRepository;
  auditRepository: AuditRepository;
  webhookSecret: string;
  now?: () => Date;
}

export class WebhookService {
  private readonly now: () => Date;

  constructor(
    private readonly dependencies: WebhookServiceDependencies
  ) {
    this.now = dependencies.now ?? (() => new Date());
  }

  private verifySignature(rawBody: Buffer, signature: string): boolean {
    const supplied = signature.replace(/^sha256=/, "").trim();

    if (!/^[a-f0-9]{64}$/i.test(supplied)) {
      return false;
    }

    const expected = createHmac(
      "sha256",
      this.dependencies.webhookSecret
    )
      .update(rawBody)
      .digest();

    const actual = Buffer.from(supplied, "hex");

    return (
      actual.length === expected.length &&
      timingSafeEqual(actual, expected)
    );
  }

  private parsePayload(rawBody: Buffer): WebhookPayload {
    let payload: unknown;

    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new WebhookProcessingError("Malformed JSON payload", 400);
    }

    if (!payload || typeof payload !== "object") {
      throw new WebhookProcessingError("Invalid webhook payload", 400);
    }

    const event = payload as Record<string, unknown>;

    const supportedTypes = [
      "payment.succeeded",
      "payment.failed",
      "payment.refunded"
    ];

    if (
      typeof event.event_id !== "string" ||
      !event.event_id.trim() ||
      typeof event.subscription_id !== "string" ||
      typeof event.invoice_id !== "string" ||
      typeof event.type !== "string" ||
      !supportedTypes.includes(event.type) ||
      typeof event.amount !== "number" ||
      !Number.isSafeInteger(event.amount) ||
      event.amount < 0 ||
      typeof event.currency !== "string" ||
      !/^[A-Za-z]{3}$/.test(event.currency)
    ) {
      throw new WebhookProcessingError(
        "Invalid or unsupported webhook fields",
        400
      );
    }

    return {
      event_id: event.event_id,
      type: event.type as WebhookPayload["type"],
      subscription_id: event.subscription_id,
      invoice_id: event.invoice_id,
      amount: event.amount,
      currency: event.currency.toUpperCase()
    };
  }

  process(
    rawBody: Buffer,
    signature: string
  ): {
    duplicate: boolean;
    outcome: "processed" | "ignored" | "duplicate";
  } {
    if (!this.verifySignature(rawBody, signature)) {
      throw new WebhookProcessingError(
        "Invalid webhook signature",
        401
      );
    }

    const event = this.parsePayload(rawBody);

    const subscription =
      this.dependencies.subscriptionRepository.findById(
        event.subscription_id
      );

    if (!subscription) {
      throw new WebhookProcessingError(
        "Subscription not found",
        404
      );
    }

    const invoice =
      this.dependencies.invoiceRepository.findById(
        event.invoice_id
      );

    if (!invoice) {
      throw new WebhookProcessingError("Invoice not found", 404);
    }

    if (
      invoice.subscriptionId !== subscription.id ||
      invoice.amount !== event.amount ||
      invoice.currency.toUpperCase() !== event.currency
    ) {
      throw new WebhookProcessingError(
        "Webhook does not match the invoice",
        409
      );
    }

    const existing =
      this.dependencies.webhookEventRepository.findByEventId(
        event.event_id
      );

    if (
      existing &&
      (
        existing.type !== event.type ||
        existing.subscriptionId !== event.subscription_id ||
        existing.invoiceId !== event.invoice_id ||
        existing.amount !== event.amount ||
        existing.currency.toUpperCase() !== event.currency
      )
    ) {
      throw new WebhookProcessingError(
        "Event ID was reused with a different payload",
        409
      );
    }

    const isNew =
      this.dependencies.webhookEventRepository.recordDelivery(
        {
          eventId: event.event_id,
          type: event.type,
          subscriptionId: event.subscription_id,
          invoiceId: event.invoice_id,
          amount: event.amount,
          currency: event.currency
        },
        this.now().toISOString()
      );

    if (!isNew && existing?.processed) {
      return {
        duplicate: true,
        outcome: "duplicate"
      };
    }

    const previousStatus = subscription.status;
    let nextStatus: SubscriptionStatus = previousStatus;
    let outcome: "processed" | "ignored" = "processed";

    if (event.type === "payment.succeeded") {
      if (
        invoice.status !== "succeeded" &&
        invoice.status !== "refunded"
      ) {
        this.dependencies.invoiceRepository.updatePaymentResult(
          invoice.id,
          "succeeded",
          invoice.providerReference
        );

        if (
          subscription.status === "trialing" ||
          subscription.status === "past_due"
        ) {
          nextStatus = SubscriptionStateMachine.transition(
            subscription.status,
            "payment.succeeded"
          );
        }

        if (subscription.status === "canceled") {
          outcome = "ignored";
        }
      } else {
        outcome = "ignored";
      }
    }

    if (event.type === "payment.failed") {
      if (
        invoice.status === "succeeded" ||
        invoice.status === "refunded"
      ) {
        outcome = "ignored";
      } else {
        this.dependencies.invoiceRepository.updatePaymentResult(
          invoice.id,
          "failed",
          invoice.providerReference,
          "payment_failed"
        );

        if (
          subscription.status === "trialing" ||
          subscription.status === "active"
        ) {
          nextStatus = SubscriptionStateMachine.transition(
            subscription.status,
            "payment.failed"
          );
        }
      }
    }

    if (event.type === "payment.refunded") {
      if (invoice.status === "succeeded") {
        this.dependencies.invoiceRepository.updatePaymentResult(
          invoice.id,
          "refunded",
          invoice.providerReference
        );
      } else {
        outcome = "ignored";
      }
    }

    if (nextStatus !== previousStatus) {
      this.dependencies.subscriptionRepository.updateStatus(
        subscription.id,
        nextStatus,
        this.now().toISOString()
      );
    }

    this.dependencies.auditRepository.save({
      id: `audit_${randomUUID()}`,
      subscriptionId: subscription.id,
      eventType: event.type,
      previousStatus,
      newStatus: nextStatus,
      occurredAt: this.now().toISOString()
    });

    this.dependencies.webhookEventRepository.markProcessed(
      event.event_id
    );

    return {
      duplicate: false,
      outcome
    };
  }
}