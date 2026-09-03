import crypto from "crypto";
import { PaymentStatus } from "../domain/Payment";
import { InvoiceStatus } from "../domain/Invoice";
import { SubscriptionStatus } from "../domain/SubscriptionStatus";
import { WebhookEventType } from "../domain/WebhookEvent";
import { PaymentRepository } from "../repository/PaymentRepository";
import { InvoiceRepository } from "../repository/InvoiceRepository";
import { SubscriptionRepository } from "../repository/SubscriptionRepository";
import { WebhookEventRepository } from "../repository/WebhookEventRepository";
import { SubscriptionStateMachine } from "../domain/SubscriptionStateMachine";
import { AuditEventRepository } from "../repository/AuditEventRepository";

export interface WebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  payment_id: string;
  amount: number;
}

export class WebhookService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly webhookEventRepository: WebhookEventRepository,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly stateMachine: SubscriptionStateMachine,
    private readonly webhookSecret: string
  ) {}

  verifySignature(rawBody: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (signature.length !== expectedSignature.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  processWebhook(payload: WebhookPayload): void {
    const existingEvent =
      this.webhookEventRepository.findByEventId(payload.event_id);

    if (existingEvent?.processed) {
      return;
    }

    this.webhookEventRepository.save({
      eventId: payload.event_id,
      type: payload.type,
      processed: false,
      receivedAt: new Date(),
    });

    switch (payload.type) {
      case "payment.succeeded":
        this.handlePaymentSucceeded(payload);
        break;

      case "payment.failed":
        this.handlePaymentFailed(payload);
        break;

      case "payment.refunded":
        this.handlePaymentRefunded(payload);
        break;

      default:
        throw new Error(
          `Unsupported webhook event: ${payload.type}`
        );
    }

    const event =
      this.webhookEventRepository.findByEventId(payload.event_id);

    if (event) {
      event.processed = true;
      event.processedAt = new Date();
      this.webhookEventRepository.save(event);
    }
  }

  private handlePaymentSucceeded(
    payload: WebhookPayload
  ): void {
    const subscription =
      this.subscriptionRepository.findById(
        payload.subscription_id
      );

    if (
      !subscription ||
      subscription.status === SubscriptionStatus.CANCELED
    ) {
      return;
    }

    const existingPayment =
      this.paymentRepository.findById(payload.payment_id);

    if (existingPayment) {
      if (
        existingPayment.status === PaymentStatus.SUCCEEDED
      ) {
        return;
      }

      if (
        existingPayment.status === PaymentStatus.REFUNDED
      ) {
        return;
      }
    }

    const payment = {
      id: payload.payment_id,
      invoiceId: payload.invoice_id,
      subscriptionId: payload.subscription_id,
      amountInCents: payload.amount,
      status: PaymentStatus.SUCCEEDED,
      providerPaymentId: payload.payment_id,
      createdAt: new Date(),
    };

    this.paymentRepository.save(payment);

    // Update invoice
    const invoice =
      this.invoiceRepository.findById(payload.invoice_id);

    if (invoice) {
      invoice.status = InvoiceStatus.PAID;
      invoice.paidAt = new Date();
      this.invoiceRepository.save(invoice);
    }

    if (
      subscription.status === SubscriptionStatus.TRIALING ||
      subscription.status === SubscriptionStatus.PAST_DUE
    ) {
      const previousStatus = subscription.status;

      subscription.status = this.stateMachine.transition(
        previousStatus,
        SubscriptionStatus.ACTIVE
      );

      subscription.retryCount = 0;

      this.subscriptionRepository.save(subscription);

      this.auditEventRepository.save({
        id: `audit_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        subscriptionId: subscription.id,
        eventType: "payment.succeeded",
        fromStatus: previousStatus,
        toStatus: SubscriptionStatus.ACTIVE,
        createdAt: new Date(),
      });
    }
  }

  private handlePaymentFailed(
    payload: WebhookPayload
  ): void {
    const subscription =
      this.subscriptionRepository.findById(
        payload.subscription_id
      );

    if (
      !subscription ||
      subscription.status === SubscriptionStatus.CANCELED
    ) {
      return;
    }

    const existingPayment =
      this.paymentRepository.findById(payload.payment_id);

    // Ignore an old failed event if this payment already succeeded.
    if (
      existingPayment?.status === PaymentStatus.SUCCEEDED
    ) {
      return;
    }

    if (!existingPayment) {
      this.paymentRepository.save({
        id: payload.payment_id,
        invoiceId: payload.invoice_id,
        subscriptionId: payload.subscription_id,
        amountInCents: payload.amount,
        status: PaymentStatus.FAILED,
        providerPaymentId: payload.payment_id,
        createdAt: new Date(),
      });
    }

    // Update invoice
    const invoice =
      this.invoiceRepository.findById(payload.invoice_id);

    if (invoice) {
      invoice.status = InvoiceStatus.FAILED;
      this.invoiceRepository.save(invoice);
    }

    if (
      subscription.status === SubscriptionStatus.ACTIVE ||
      subscription.status === SubscriptionStatus.TRIALING
    ) {
      const previousStatus = subscription.status;

      subscription.status = this.stateMachine.transition(
        previousStatus,
        SubscriptionStatus.PAST_DUE
      );

      this.subscriptionRepository.save(subscription);

      this.auditEventRepository.save({
        id: `audit_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        subscriptionId: subscription.id,
        eventType: "payment.failed",
        fromStatus: previousStatus,
        toStatus: SubscriptionStatus.PAST_DUE,
        createdAt: new Date(),
      });
    }
  }

  private handlePaymentRefunded(
    payload: WebhookPayload
  ): void {
    const payment =
      this.paymentRepository.findById(payload.payment_id);

    if (!payment) {
      return;
    }

    if (payment.status === PaymentStatus.REFUNDED) {
      return;
    }

    payment.status = PaymentStatus.REFUNDED;
    this.paymentRepository.save(payment);
  }
}