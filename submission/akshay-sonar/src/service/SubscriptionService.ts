import { Invoice, InvoiceStatus } from "../domain/Invoice";
import { Payment, PaymentStatus } from "../domain/Payment";
import { Plan, PlanId } from "../domain/Plan";
import { Subscription } from "../domain/Subscription";
import { SubscriptionStateMachine } from "../domain/SubscriptionStateMachine";
import { SubscriptionStatus } from "../domain/SubscriptionStatus";
import {
  PaymentProvider,
  PaymentRequest,
} from "../provider/PaymentProvider";
import { AuditEvent } from "../domain/AuditEvent";
import { SubscriptionRepository } from "../repository/SubscriptionRepository";
import { InvoiceRepository } from "../repository/InvoiceRepository";
import { PaymentRepository } from "../repository/PaymentRepository";
import { AuditEventRepository } from "../repository/AuditEventRepository";

export class SubscriptionService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly auditEventRepository: AuditEventRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly stateMachine: SubscriptionStateMachine,
    private readonly plans: Record<PlanId, Plan>
  ) {}

  createSubscription(
    customerId: string,
    planId: PlanId,
    now: Date = new Date()
  ): Subscription {
    const plan = this.plans[planId];

    if (!plan) {
      throw new Error(`Unknown plan: ${planId}`);
    }

    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + plan.trialDays);

    const currentPeriodEndsAt = new Date(now);
    currentPeriodEndsAt.setDate(currentPeriodEndsAt.getDate() + 30);

    const subscription: Subscription = {
      id: `subscription_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      customerId,
      planId,
      status: SubscriptionStatus.TRIALING,
      trialEndsAt,
      currentPeriodEndsAt,
      createdAt: new Date(now),
      retryCount: 0,
      maxRetries: 3,
    };

    this.subscriptionRepository.save(subscription);

    this.recordAuditEvent(
      subscription,
      "subscription.created",
      undefined,
      SubscriptionStatus.TRIALING
    );

    return subscription;
  }

  getSubscription(id: string): Subscription | undefined {
    return this.subscriptionRepository.findById(id);
  }

  cancelSubscription(id: string): Subscription {
    const subscription = this.getRequiredSubscription(id);

    this.changeStatus(
      subscription,
      SubscriptionStatus.CANCELED,
      "subscription.canceled"
    );

    subscription.canceledAt = new Date();

    this.subscriptionRepository.save(subscription);

    return subscription;
  }

  async processPayment(
    subscriptionId: string,
    now: Date = new Date()
  ): Promise<Payment> {
    const subscription = this.getRequiredSubscription(subscriptionId);

    if (subscription.status === SubscriptionStatus.CANCELED) {
      throw new Error("Canceled subscription cannot be charged");
    }

    const plan = this.plans[subscription.planId];

    const invoice: Invoice = {
      id: `invoice_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      subscriptionId: subscription.id,
      amountInCents: plan.priceInCents,
      status: InvoiceStatus.OPEN,
      createdAt: new Date(now),
    };

    this.invoiceRepository.save(invoice);

    const request: PaymentRequest = {
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      amountInCents: invoice.amountInCents,
    };

    let providerResult;

    try {
      providerResult = await this.paymentProvider.charge(request);
    } catch (error) {
      invoice.status = InvoiceStatus.FAILED;
      this.invoiceRepository.save(invoice);

      if (subscription.status === SubscriptionStatus.TRIALING) {
        this.changeStatus(
          subscription,
          SubscriptionStatus.PAST_DUE,
          "payment.failed"
        );
      } else if (subscription.status === SubscriptionStatus.PAST_DUE) {
        this.handleRetryFailure(subscription);
      }

      throw error;
    }

    if (providerResult.success) {
      invoice.status = InvoiceStatus.PAID;
      invoice.paidAt = new Date(now);
      this.invoiceRepository.save(invoice);

      const payment: Payment = {
        id: providerResult.providerPaymentId,
        invoiceId: invoice.id,
        subscriptionId: subscription.id,
        amountInCents: invoice.amountInCents,
        status: PaymentStatus.SUCCEEDED,
        providerPaymentId: providerResult.providerPaymentId,
        createdAt: new Date(now),
      };

      this.paymentRepository.save(payment);

      if (
        subscription.status === SubscriptionStatus.TRIALING ||
        subscription.status === SubscriptionStatus.PAST_DUE
      ) {
        this.changeStatus(
          subscription,
          SubscriptionStatus.ACTIVE,
          "payment.succeeded"
        );
      }

      // Successful payment resets the retry counter.
      subscription.retryCount = 0;
      this.subscriptionRepository.save(subscription);

      return payment;
    }

    invoice.status = InvoiceStatus.FAILED;
    this.invoiceRepository.save(invoice);

    const payment: Payment = {
      id: providerResult.providerPaymentId,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      amountInCents: invoice.amountInCents,
      status: PaymentStatus.FAILED,
      providerPaymentId: providerResult.providerPaymentId,
      createdAt: new Date(now),
    };

    this.paymentRepository.save(payment);

    if (subscription.status === SubscriptionStatus.TRIALING) {
      this.changeStatus(
        subscription,
        SubscriptionStatus.PAST_DUE,
        "payment.failed"
      );
    } else if (subscription.status === SubscriptionStatus.PAST_DUE) {
      this.handleRetryFailure(subscription);
    }

    return payment;
  }

  processRefund(paymentId: string): Payment {
    const payment = this.paymentRepository.findById(paymentId);

    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    if (payment.status === PaymentStatus.REFUNDED) {
      return payment;
    }

    payment.status = PaymentStatus.REFUNDED;
    this.paymentRepository.save(payment);

    return payment;
  }

  private handleRetryFailure(subscription: Subscription): void {
    subscription.retryCount += 1;

    if (subscription.retryCount >= subscription.maxRetries) {
      this.changeStatus(
        subscription,
        SubscriptionStatus.CANCELED,
        "payment.retries_exhausted"
      );

      subscription.canceledAt = new Date();
      this.subscriptionRepository.save(subscription);
      return;
    }

    this.subscriptionRepository.save(subscription);

    this.recordAuditEvent(
      subscription,
      "payment.retry_failed",
      SubscriptionStatus.PAST_DUE,
      SubscriptionStatus.PAST_DUE
    );
  }

  private changeStatus(
    subscription: Subscription,
    nextStatus: SubscriptionStatus,
    eventType: string
  ): void {
    const previousStatus = subscription.status;

    subscription.status = this.stateMachine.transition(
      previousStatus,
      nextStatus
    );

    this.subscriptionRepository.save(subscription);

    this.recordAuditEvent(
      subscription,
      eventType,
      previousStatus,
      nextStatus
    );
  }

  private recordAuditEvent(
    subscription: Subscription,
    eventType: string,
    fromStatus?: SubscriptionStatus,
    toStatus?: SubscriptionStatus
  ): void {
    const event: AuditEvent = {
      id: `audit_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      subscriptionId: subscription.id,
      eventType,
      fromStatus,
      toStatus,
      createdAt: new Date(),
    };

    this.auditEventRepository.save(event);
  }

  private getRequiredSubscription(id: string): Subscription {
    const subscription = this.subscriptionRepository.findById(id);

    if (!subscription) {
      throw new Error(`Subscription not found: ${id}`);
    }

    return subscription;
  }
}