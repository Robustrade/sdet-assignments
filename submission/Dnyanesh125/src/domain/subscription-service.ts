import { SubscriptionBuilder } from '../builders/subscription-builder';
import { PlanName } from './plan';
import { PaymentProvider } from '../providers/payment-provider';
import { InMemoryBillingRepository } from '../repositories/in-memory-billing-repository';

export interface CreateSubscriptionRequest {
  customerId: string;
  plan: PlanName;
  paymentMethodId: string;
}

export interface PaymentSucceededEvent {
  eventId: string;
  subscriptionId: string;
  invoiceId: string;
  amountCents: number;
  currency: string;
  providerPaymentId: string;
}

export class SubscriptionService {
  constructor(
    private readonly repository: InMemoryBillingRepository,
    private readonly paymentProvider: PaymentProvider,
  ) {}

  async createSubscription(
    request: CreateSubscriptionRequest,
  ) {
    const subscription = new SubscriptionBuilder()
      .forCustomer(request.customerId)
      .withPlan(request.plan)
      .withPaymentMethod(request.paymentMethodId)
      .withStatus('trialing')
      .build();

    this.repository.saveSubscription(subscription);

    return subscription;
  }

  async handlePaymentSucceeded(
    event: PaymentSucceededEvent,
  ) {
    const subscription = this.repository.findSubscription(
      event.subscriptionId,
    );

    if (!subscription) {
      throw new Error(
        `Subscription not found: ${event.subscriptionId}`,
      );
    }

    subscription.status = 'active';

    this.repository.saveSubscription(subscription);

    this.repository.saveInvoice({
      id: event.invoiceId,
      subscriptionId: event.subscriptionId,
      amountCents: event.amountCents,
      currency: event.currency,
      status: 'paid',
      providerPaymentId: event.providerPaymentId,
    });

    this.repository.saveWebhookEvent({
      eventId: event.eventId,
      subscriptionId: event.subscriptionId,
      type: 'payment.succeeded',
      processed: true,
    });

    return subscription;
  }
}
