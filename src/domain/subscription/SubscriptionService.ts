import { Subscription, Invoice, CreateSubscriptionRequest, PlanConfig } from './types';
import { PaymentProvider } from '../../infrastructure/payment/PaymentProvider';
import { SubscriptionRepository } from '../../infrastructure/persistence/SubscriptionRepository';
import { InvoiceRepository } from '../../infrastructure/persistence/InvoiceRepository';
import { createState } from './states';
import { randomUUID } from 'crypto';

export const PLANS: Record<string, PlanConfig> = {
  basic: { name: 'basic', price: 2900, currency: 'USD', trial_days: 7, billing_interval: 'month' },
  pro: { name: 'pro', price: 4900, currency: 'USD', trial_days: 14, billing_interval: 'month' }
};

export class SubscriptionService {
  constructor(
    private subscriptionRepo: SubscriptionRepository,
    private invoiceRepo: InvoiceRepository,
    private paymentProvider: PaymentProvider
  ) {}

  async createSubscription(request: CreateSubscriptionRequest): Promise<Subscription> {
    // Validate plan
    const planConfig = PLANS[request.plan];
    if (!planConfig) {
      throw new Error(`Invalid plan: ${request.plan}`);
    }

    // Calculate trial end date
    const now = new Date();
    const trialEndAt = new Date(now);
    trialEndAt.setDate(trialEndAt.getDate() + planConfig.trial_days);

    // Create subscription in trialing state
    const subscription: Subscription = {
      id: `sub_${randomUUID()}`,
      customer_id: request.customer_id,
      plan: request.plan,
      status: 'trialing',
      payment_method_id: request.payment_method_id,
      created_at: now,
      trial_end_at: trialEndAt
    };

    await this.subscriptionRepo.save(subscription);
    return subscription;
  }

  async getSubscription(id: string): Promise<Subscription | null> {
    return this.subscriptionRepo.findById(id);
  }

  async cancelSubscription(id: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepo.findById(id);
    if (!subscription) {
      throw new Error(`Subscription not found: ${id}`);
    }

    // Use state pattern to handle cancellation
    const currentState = createState(subscription.status);
    const newState = currentState.onCancel();

    subscription.status = newState.status;
    subscription.canceled_at = new Date();

    await this.subscriptionRepo.save(subscription);
    return subscription;
  }

  async handlePaymentSuccess(subscriptionId: string, invoiceId: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepo.findById(subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    // Use state pattern to handle payment success
    const currentState = createState(subscription.status);
    const newState = currentState.onPaymentSuccess();

    subscription.status = newState.status;
    await this.subscriptionRepo.save(subscription);

    // Update invoice status
    const invoice = await this.invoiceRepo.findById(invoiceId);
    if (invoice) {
      invoice.status = 'paid';
      invoice.paid_at = new Date();
      await this.invoiceRepo.save(invoice);
    }

    return subscription;
  }

  async handlePaymentFailure(subscriptionId: string, invoiceId: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepo.findById(subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    // Use state pattern to handle payment failure
    const currentState = createState(subscription.status);
    const newState = currentState.onPaymentFailure();

    subscription.status = newState.status;
    await this.subscriptionRepo.save(subscription);

    // Update invoice status
    const invoice = await this.invoiceRepo.findById(invoiceId);
    if (invoice) {
      invoice.status = 'failed';
      await this.invoiceRepo.save(invoice);
    }

    return subscription;
  }

  async chargeSubscription(subscriptionId: string): Promise<Invoice> {
    const subscription = await this.subscriptionRepo.findById(subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }

    const planConfig = PLANS[subscription.plan];
    const invoice: Invoice = {
      id: `inv_${randomUUID()}`,
      subscription_id: subscriptionId,
      amount: planConfig.price,
      currency: planConfig.currency,
      status: 'pending',
      attempt_count: 1,
      created_at: new Date()
    };

    await this.invoiceRepo.save(invoice);

    try {
      const result = await this.paymentProvider.chargeCustomer(
        invoice.amount,
        subscription.payment_method_id,
        {
          subscription_id: subscriptionId,
          invoice_id: invoice.id
        }
      );

      if (result.success) {
        invoice.status = 'paid';
        invoice.paid_at = new Date();
        await this.invoiceRepo.save(invoice);
        await this.handlePaymentSuccess(subscriptionId, invoice.id);
      } else {
        invoice.status = 'failed';
        await this.invoiceRepo.save(invoice);
        await this.handlePaymentFailure(subscriptionId, invoice.id);
      }
    } catch (error) {
      invoice.status = 'failed';
      await this.invoiceRepo.save(invoice);
      await this.handlePaymentFailure(subscriptionId, invoice.id);
    }

    return invoice;
  }
}
