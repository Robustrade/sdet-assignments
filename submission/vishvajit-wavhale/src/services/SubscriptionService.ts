
import type BetterSqlite3 from 'better-sqlite3';

import { CustomerRepository } from '../repositories/CustomerRepository.js';
import { PlanRepository } from '../repositories/PlanRepository.js';
import { SubscriptionRepository } from '../repositories/SubscriptionRepository.js';
import { InvoiceRepository } from '../repositories/InvoiceRepository.js';
import { AuditLogRepository } from '../repositories/AuditLogRepository.js';

import { SubscriptionStateMachine } from '../domain/subscription/SubscriptionStateMachine.js';

import type {
  SubscriptionEvent
} from '../domain/subscription/SubscriptionStatus.js';

import type {
  PaymentProvider,
  PaymentResult
} from '../payment/PaymentProvider.js';

export class SubscriptionService {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly customerRepository: CustomerRepository,
    private readonly planRepository: PlanRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly stateMachine: SubscriptionStateMachine,
    private readonly paymentProvider: PaymentProvider
  ) {}

  createSubscription(input: {
    id: string;
    customerId: string;
    planId: string;
    paymentMethodId: string;
  }) {
    return this.db.transaction(() => {
      const customer = this.customerRepository.findById(
        input.customerId
      );

      if (!customer) {
        throw new Error('Customer not found');
      }

      const plan = this.planRepository.findById(input.planId);

      if (!plan) {
        throw new Error('Plan not found');
      }

      const now = new Date();
      const trialEndsAt = new Date(now);

      trialEndsAt.setUTCDate(
        trialEndsAt.getUTCDate() + plan.trial_days
      );

      const subscription = this.subscriptionRepository.create({
        id: input.id,
        customer_id: input.customerId,
        plan_id: input.planId,
        payment_method_id: input.paymentMethodId,
        status: 'trialing',
        trial_ends_at: trialEndsAt.toISOString(),
        current_period_start: now.toISOString()
      });

      this.auditLogRepository.create({
        subscription_id: subscription.id,
        event_type: 'subscription.created',
        previous_state: null,
        new_state: 'trialing',
        source: 'api',
        metadata: {
          customerId: input.customerId,
          planId: input.planId
        }
      });

      return subscription;
    })();
  }

  getSubscription(subscriptionId: string) {
    return this.subscriptionRepository.findById(subscriptionId);
  }

  applyEvent(
    subscriptionId: string,
    event: SubscriptionEvent,
    source: string
  ) {
    return this.db.transaction(() => {
      const subscription =
        this.subscriptionRepository.findById(subscriptionId);

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      const previousState = subscription.status;

      const nextState = this.stateMachine.transition(
        previousState,
        event
      );

      const updatedSubscription =
        nextState === 'canceled'
          ? this.subscriptionRepository.cancel(
              subscriptionId,
              new Date().toISOString()
            )
          : this.subscriptionRepository.updateStatus(
              subscriptionId,
              nextState
            );

      this.auditLogRepository.create({
        subscription_id: subscriptionId,
        event_type: event.toLowerCase(),
        previous_state: previousState,
        new_state: nextState,
        source
      });

      return updatedSubscription;
    })();
  }

  cancelSubscription(subscriptionId: string) {
    return this.applyEvent(
      subscriptionId,
      'CUSTOMER_CANCELED',
      'api'
    );
  }

  async processPayment(
    subscriptionId: string,
    invoiceId: string
  ): Promise<{
    subscription: NonNullable<
      ReturnType<SubscriptionRepository['findById']>
    >;
    invoice: ReturnType<InvoiceRepository['findById']>;
    paymentResult: PaymentResult;
  }> {
    const subscription =
      this.subscriptionRepository.findById(subscriptionId);

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (subscription.status === 'canceled') {
      throw new Error('Cannot charge a canceled subscription');
    }

    const plan = this.planRepository.findById(
      subscription.plan_id
    );

    if (!plan) {
      throw new Error('Plan not found');
    }

    // Reuse an existing invoice during a retry.
    // Create a new invoice only when it does not exist.
    let invoice = this.invoiceRepository.findById(invoiceId);

    if (invoice) {
      if (
        invoice.subscription_id !== subscriptionId ||
        invoice.amount !== plan.price_cents ||
        invoice.currency !== plan.currency
      ) {
        throw new Error(
          'Existing invoice does not match the payment request'
        );
      }

      // Never charge an already-finalized invoice again.
      if (invoice.status === 'succeeded') {
        const paymentResult: PaymentResult = {
          status: 'succeeded',
          providerReference:
            invoice.provider_reference ?? `existing_${invoice.id}`
        };

        return {
          subscription,
          invoice,
          paymentResult
        };
      }

      if (invoice.status === 'failed') {
        const paymentResult: PaymentResult = {
          status: 'declined',
          reason: invoice.failure_reason ?? 'Payment previously declined'
        };

        return {
          subscription,
          invoice,
          paymentResult
        };
      }

      if (invoice.status === 'refunded') {
        throw new Error('Cannot charge a refunded invoice');
      }
    } else {
      invoice = this.db.transaction(() => {
        return this.invoiceRepository.create({
          id: invoiceId,
          subscription_id: subscriptionId,
          amount: plan.price_cents,
          currency: plan.currency
        });
      })();
    }

    const paymentResult = await this.paymentProvider.charge({
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      customerId: subscription.customer_id,
      paymentMethodId: subscription.payment_method_id,
      amount: plan.price_cents,
      currency: plan.currency,

      // Stable across retries of this invoice.
      idempotencyKey: invoice.id
    });

    // A timeout leaves the invoice pending.
    // A retry must use the same invoice ID and idempotency key.
    if (paymentResult.status === 'timeout') {
      const currentSubscription =
        this.subscriptionRepository.findById(subscriptionId);

      if (!currentSubscription) {
        throw new Error('Subscription not found');
      }

      return {
        subscription: currentSubscription,
        invoice: this.invoiceRepository.findById(invoiceId),
        paymentResult
      };
    }

    if (paymentResult.status === 'succeeded') {
      const updated = this.db.transaction(() => {
        this.invoiceRepository.updatePaymentResult(invoiceId, {
          status: 'succeeded',
          provider_reference: paymentResult.providerReference
        });

        const currentSubscription =
          this.subscriptionRepository.findById(subscriptionId);

        if (!currentSubscription) {
          throw new Error('Subscription not found');
        }

        if (currentSubscription.status === 'trialing') {
          this.applyEvent(
            subscriptionId,
            'PAYMENT_SUCCEEDED',
            'payment_provider'
          );
        } else if (currentSubscription.status === 'past_due') {
          this.applyEvent(
            subscriptionId,
            'RETRY_SUCCEEDED',
            'payment_provider'
          );
        }

        return this.subscriptionRepository.findById(subscriptionId);
      })();

      if (!updated) {
        throw new Error('Subscription update failed');
      }

      return {
        subscription: updated,
        invoice: this.invoiceRepository.findById(invoiceId),
        paymentResult
      };
    }

    const updated = this.db.transaction(() => {
      this.invoiceRepository.updatePaymentResult(invoiceId, {
        status: 'failed',
        failure_reason: paymentResult.reason
      });

      const currentSubscription =
        this.subscriptionRepository.findById(subscriptionId);

      if (!currentSubscription) {
        throw new Error('Subscription not found');
      }

      if (
        currentSubscription.status === 'trialing' ||
        currentSubscription.status === 'active'
      ) {
        this.applyEvent(
          subscriptionId,
          'PAYMENT_FAILED',
          'payment_provider'
        );
      }

      return this.subscriptionRepository.findById(subscriptionId);
    })();

    if (!updated) {
      throw new Error('Subscription update failed');
    }

    return {
      subscription: updated,
      invoice: this.invoiceRepository.findById(invoiceId),
      paymentResult
    };
  }
}
