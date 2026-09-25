import type { SubscriptionRepository } from "../repositories/subscription-repository.js";
import type { InvoiceRepository } from "../repositories/invoice-repository.js";
import type { PaymentRepository } from "../repositories/payment-repository.js";
import type { WebhookEventRepository } from "../repositories/webhook-event-repository.js";
import type { AuditEventRepository } from "../repositories/audit-event-repository.js";

import type { WebhookEvent } from "../domain/webhook-event.js";
import type { Payment } from "../domain/payment.js";

import {
  SubscriptionStateMachine,
  InvalidSubscriptionTransitionError,
} from "../domain/subscription-state.js";

export class WebhookService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly webhookEventRepository: WebhookEventRepository,
    private readonly auditEventRepository: AuditEventRepository,
  ) {}

  process(event: WebhookEvent): void {
    // Idempotency: the same event_id must only be processed once.
    const existingEvent =
      this.webhookEventRepository.findByEventId(event.eventId);

    if (existingEvent) {
      return;
    }

    const subscription =
      this.subscriptionRepository.findById(event.subscriptionId);

    if (!subscription) {
      throw new Error(
        `Subscription not found: ${event.subscriptionId}`,
      );
    }

    const invoice =
      this.invoiceRepository.findById(event.invoiceId);

    if (!invoice) {
      throw new Error(`Invoice not found: ${event.invoiceId}`);
    }

    switch (event.type) {
      case "payment.succeeded":
        this.processPaymentSucceeded(event, subscription.id);
        break;

      case "payment.failed":
        this.processPaymentFailed(event, subscription.id);
        break;

      case "payment.refunded":
        this.processPaymentRefunded(event);
        break;
    }

    this.webhookEventRepository.save({
      ...event,
      processedAt: new Date(),
    });
  }

  private processPaymentSucceeded(
    event: WebhookEvent,
    subscriptionId: string,
  ): void {
    const existingSuccessfulPayment =
      this.paymentRepository
        .findByInvoiceId(event.invoiceId)
        .find((payment) => payment.status === "succeeded");

    if (!existingSuccessfulPayment) {
      const payment: Payment = {
        id: `pay_${event.eventId}`,
        invoiceId: event.invoiceId,
        subscriptionId,
        amountCents: event.amountCents,
        currency: event.currency,
        status: "succeeded",
        providerReference: event.eventId,
        createdAt: new Date(),
      };

      this.paymentRepository.save(payment);
    }

    const subscription =
      this.subscriptionRepository.findById(subscriptionId);

    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const previousState = subscription.state;

    try {
      const nextState = new SubscriptionStateMachine(
        subscription.state,
      ).transition("payment.succeeded");

      subscription.state = nextState;
      this.subscriptionRepository.save(subscription);

      this.auditEventRepository.save({
        id: `audit_${event.eventId}`,
        subscriptionId,
        eventType: event.type,
        previousState,
        nextState,
        metadata: {
          eventId: event.eventId,
          invoiceId: event.invoiceId,
        },
        createdAt: new Date(),
      });
    } catch (error) {
      if (error instanceof InvalidSubscriptionTransitionError) {
        return;
      }

      throw error;
    }
  }

  private processPaymentFailed(
    event: WebhookEvent,
    subscriptionId: string,
  ): void {
    const payments =
      this.paymentRepository.findByInvoiceId(event.invoiceId);

    // A later failure must not regress a subscription whose
    // same billing attempt has already succeeded.
    const alreadySucceeded = payments.some(
      (payment) => payment.status === "succeeded",
    );

    if (alreadySucceeded) {
      return;
    }

    const existingFailedPayment = payments.find(
      (payment) => payment.status === "failed",
    );

    if (!existingFailedPayment) {
      this.paymentRepository.save({
        id: `pay_${event.eventId}`,
        invoiceId: event.invoiceId,
        subscriptionId,
        amountCents: event.amountCents,
        currency: event.currency,
        status: "failed",
        providerReference: event.eventId,
        createdAt: new Date(),
      });
    }

    const subscription =
      this.subscriptionRepository.findById(subscriptionId);

    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const previousState = subscription.state;

    try {
      const nextState = new SubscriptionStateMachine(
        subscription.state,
      ).transition("payment.failed");

      subscription.state = nextState;
      this.subscriptionRepository.save(subscription);

      this.auditEventRepository.save({
        id: `audit_${event.eventId}`,
        subscriptionId,
        eventType: event.type,
        previousState,
        nextState,
        metadata: {
          eventId: event.eventId,
          invoiceId: event.invoiceId,
        },
        createdAt: new Date(),
      });
    } catch (error) {
      if (error instanceof InvalidSubscriptionTransitionError) {
        return;
      }

      throw error;
    }
  }

  private processPaymentRefunded(event: WebhookEvent): void {
    const payments =
      this.paymentRepository.findByInvoiceId(event.invoiceId);

    const existingPayment = payments.find(
      (payment) => payment.status === "succeeded",
    );

    if (existingPayment) {
      existingPayment.status = "refunded";
      this.paymentRepository.save(existingPayment);
    }

    const invoice = this.invoiceRepository.findById(event.invoiceId);

    if (invoice) {
      invoice.status = "refunded";
      this.invoiceRepository.save(invoice);
    }
  }
}