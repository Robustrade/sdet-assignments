import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { PaymentProvider } from './payment-provider';
import { CustomerValidator, CustomerValidationError } from './customer-validator';

import {
  Subscription,
  SubscriptionRepository,
} from './repositories/subscription-repository';

import { PaymentRepository } from './repositories/payment-repository';

import { WebhookEventRepository } from './repositories/webhook-event-repository';

import { transition } from './subscription-state';
import { getPlan } from './plans/plan-registry';

export interface CreateSubscriptionRequest {
  id: string;
  customerId: string;
  plan: string;
  paymentMethodId: string;
}

export interface PaymentWebhook {
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
  subscriptionId: string;
  invoiceId: string;
  amount: number;
}

export class SubscriptionService {
  constructor(
    private subscriptionRepository: SubscriptionRepository,
    private paymentRepository: PaymentRepository,
    private webhookEventRepository: WebhookEventRepository,
    private paymentProvider: PaymentProvider,
    private customerValidator: CustomerValidator,
    private db: Database.Database,
  ) {}

  async createSubscription(
    request: CreateSubscriptionRequest,
  ): Promise<Subscription> {
    const plan = getPlan(request.plan);

    if (!plan) {
      throw new Error('Invalid plan');
    }

    if (!this.customerValidator.isKnownCustomer(request.customerId)) {
      throw new CustomerValidationError('Unknown customer');
    }

    if (!this.customerValidator.isValidPaymentMethod(
      request.customerId,
      request.paymentMethodId,
    )) {
      throw new CustomerValidationError('Invalid payment method for customer');
    }

    const subscription: Subscription = {
      id: request.id,
      customerId: request.customerId,
      plan: plan.name,
      state: 'trialing',
      paymentMethodId: request.paymentMethodId,
      trialEndsAt: new Date(
        Date.now() + plan.trialDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    };

    this.subscriptionRepository.save(subscription);

    return subscription;
  }

  async processPayment(
    subscriptionId: string,
    amount?: number,
  ): Promise<Subscription> {
    const subscription =
      this.subscriptionRepository.findById(subscriptionId);

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (subscription.state === 'canceled') {
      throw new Error('Canceled subscription cannot be billed');
    }

    const plan = getPlan(subscription.plan);

    if (!plan) {
      throw new Error('Invalid plan');
    }

    amount = amount ?? plan.price;

    const result = await this.paymentProvider.charge({
      customerId: subscription.customerId,
      paymentMethodId: subscription.paymentMethodId,
      amount,
      reference: subscription.id,
    });

    if (result.status === 'success') {
      const nextState = transition(
        subscription.state,
        'PAYMENT_SUCCEEDED',
      );

      this.paymentRepository.save({
        id: `pay_${randomUUID()}`,
        subscriptionId: subscription.id,
        amount,
        status: 'success',
        providerReference: result.transactionId,
      });

      this.subscriptionRepository.updateState(
        subscription.id,
        nextState,
      );

      return {
        ...subscription,
        state: nextState,
      };
    }

    const nextState = transition(
      subscription.state,
      'PAYMENT_FAILED',
    );

    this.paymentRepository.save({
      id: `pay_${randomUUID()}`,
      subscriptionId: subscription.id,
      amount,
      status: 'failed',
    });

    this.subscriptionRepository.updateState(
      subscription.id,
      nextState,
    );

    return {
      ...subscription,
      state: nextState,
    };
  }

  async exhaustRetries(
    subscriptionId: string,
  ): Promise<Subscription> {
    const subscription =
      this.subscriptionRepository.findById(subscriptionId);

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const nextState = transition(subscription.state, 'RETRIES_EXHAUSTED');

    this.subscriptionRepository.updateState(subscription.id, nextState);

    return { ...subscription, state: nextState };
  }

  async cancelSubscription(
    subscriptionId: string,
  ): Promise<Subscription> {
    const subscription =
      this.subscriptionRepository.findById(subscriptionId);

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const nextState = transition(
      subscription.state,
      'CANCEL',
    );

    this.subscriptionRepository.updateState(
      subscription.id,
      nextState,
    );

    return {
      ...subscription,
      state: nextState,
    };
  }

  async handleWebhook(
    event: PaymentWebhook,
  ): Promise<Subscription> {
    return this.db.transaction(() => this.processWebhook(event))();
  }

  private processWebhook(event: PaymentWebhook): Subscription {
    // Idempotency:
    // Replays update receipt metadata without repeating business writes.
    if (this.webhookEventRepository.exists(event.eventId)) {
      const existing =
        this.subscriptionRepository.findById(
          event.subscriptionId,
        );

      if (!existing) {
        throw new Error('Subscription not found');
      }

      this.webhookEventRepository.incrementDelivery(event.eventId);
      return existing;
    }

    const subscription =
      this.subscriptionRepository.findById(
        event.subscriptionId,
      );

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Refunds are audit events, not lifecycle transitions.
    if (event.type === 'payment.refunded') {
      this.paymentRepository.save({
        id: `refund_${event.eventId}`,
        subscriptionId: event.subscriptionId,
        amount: event.amount,
        status: 'refunded',
        providerReference: event.invoiceId,
      });

      this.webhookEventRepository.save({
        eventId: event.eventId,
        subscriptionId: event.subscriptionId,
        eventType: event.type,
        processed: true,
      });

      return subscription;
    }

    const payment =
      this.paymentRepository.findById(event.invoiceId);

    // A settled invoice must not be downgraded by a stale failure.
    if (
      payment?.status === 'success' &&
      event.type === 'payment.failed'
    ) {
      this.webhookEventRepository.save({
        eventId: event.eventId,
        subscriptionId: event.subscriptionId,
        eventType: event.type,
        processed: false,
      });

      return subscription;
    }

    const transitionEvent =
      event.type === 'payment.succeeded'
        ? 'PAYMENT_SUCCEEDED'
        : 'PAYMENT_FAILED';

    let nextState;

    try {
      nextState = transition(
        subscription.state,
        transitionEvent,
      );
    } catch {
      /*
       * Important:
       * The webhook is valid, but the requested state transition
       * is not valid for the subscription's current state.
       *
       * Example:
       *
       * canceled + payment.succeeded
       *
       * We record the webhook for auditability,
       * but we do NOT change the subscription
       * and we do NOT create a payment side effect.
       */
      this.webhookEventRepository.save({
        eventId: event.eventId,
        subscriptionId: event.subscriptionId,
        eventType: event.type,
        processed: false,
      });

      return subscription;
    }

    // Record successful webhook processing.
    this.webhookEventRepository.save({
      eventId: event.eventId,
      subscriptionId: event.subscriptionId,
      eventType: event.type,
      processed: true,
    });

    // Store corresponding payment result.
    this.paymentRepository.save({
      id: event.invoiceId,
      subscriptionId: event.subscriptionId,
      amount: event.amount,
      status:
        event.type === 'payment.succeeded'
          ? 'success'
          : 'failed',
    });

    // Persist the new subscription state.
    this.subscriptionRepository.updateState(
      event.subscriptionId,
      nextState,
    );

    return {
      ...subscription,
      state: nextState,
    };
  }

getSubscription(
  subscriptionId: string,
): Subscription | undefined {
  return this.subscriptionRepository.findById(
    subscriptionId,
  );
}

}
