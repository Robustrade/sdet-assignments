
import { randomUUID } from 'crypto';
import { AuditRepository } from '../repositories/audit.repository';
import { BillingRepository } from '../repositories/billing.repository';

import {
  CreateSubscriptionInput,
  Subscription
} from '../models/subscription';

import { SubscriptionRepository } from '../repositories/subscription.repository';

import { PaymentProvider } from '../providers/payment-provider';

import { getNextStatus } from '../state-machine/subscription-state';

const PLAN_PRICES = {
  basic: 1000,
  pro: 2500
};

export class SubscriptionService {
constructor(
  private repository: SubscriptionRepository,
  private paymentProvider: PaymentProvider,
  private auditRepository: AuditRepository,
  private billingRepository: BillingRepository
) {}

  createSubscription(input: CreateSubscriptionInput): Subscription {
    if (!input.customer_id) {
      throw new Error('Customer ID is required');
    }

    if (!PLAN_PRICES[input.plan]) {
      throw new Error('Invalid subscription plan');
    }

    const subscription = this.repository.create(
      input,
      randomUUID(),
      'trialing'
    );

    return subscription;
  }

  getSubscription(id: string): Subscription {
    const subscription = this.repository.findById(id);

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    return subscription;
  }

cancelSubscription(id: string): Subscription {
  const subscription = this.getSubscription(id);

  const nextStatus = getNextStatus(
    subscription.status,
    'CANCEL'
  );

  this.repository.updateStatus(id, nextStatus);

  this.auditRepository.logStatusChange(
    id,
    subscription.status,
    nextStatus,
    'Customer requested cancellation'
  );

  return this.getSubscription(id);
}


markRetriesExhausted(id: string): Subscription {
  const subscription = this.getSubscription(id);

  const nextStatus = getNextStatus(
    subscription.status,
    'RETRIES_EXHAUSTED'
  );

  this.repository.updateStatus(id, nextStatus);

  this.auditRepository.logStatusChange(
    id,
    subscription.status,
    nextStatus,
    'Payment retries exhausted'
  );

  return this.getSubscription(id);
}


    async processPayment(id: string, currency = 'USD'): Promise<Subscription> {
    const subscription = this.getSubscription(id);

    if (subscription.status === 'canceled') {
        throw new Error('Cannot charge a canceled subscription');
    }

    const amount = PLAN_PRICES[subscription.plan];

    // Create invoice before attempting payment
    const invoiceId = this.billingRepository.createInvoice(
        id,
        amount,
        'pending'
    );

    let result;

    try {
        result = await this.paymentProvider.charge({
        customerId: subscription.customer_id,
        amount,
        currency
        });
    } catch (error) {
        this.billingRepository.createPayment(
        invoiceId,
        amount,
        'timeout'
        );
        this.billingRepository.updateInvoiceStatus(invoiceId, 'timeout');
        throw error;
    }

    if (result.status === 'timeout') {
        this.billingRepository.createPayment(
        invoiceId,
        amount,
        'timeout'
        );
        this.billingRepository.updateInvoiceStatus(invoiceId, 'timeout');
        throw new Error('Payment provider timeout');
    }

    const paymentStatus =
        result.status === 'success' ? 'succeeded' : 'failed';

    // Persist payment and invoice results
    this.billingRepository.createPayment(
        invoiceId,
        amount,
        paymentStatus,
        result.transactionId
    );

    this.billingRepository.updateInvoiceStatus(
        invoiceId,
        paymentStatus
    );

    const event =
        result.status === 'success'
        ? 'PAYMENT_SUCCEEDED'
        : 'PAYMENT_FAILED';

    const nextStatus = getNextStatus(subscription.status, event);

    this.repository.updateStatus(id, nextStatus);

    this.auditRepository.logStatusChange(
        id,
        subscription.status,
        nextStatus,
        result.status === 'success'
        ? 'Payment successful'
        : 'Payment failed'
    );

    return this.getSubscription(id);
    }

}
