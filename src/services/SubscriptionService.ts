import { randomUUID } from 'node:crypto';
import type { PlanCatalog } from '../domain/PlanCatalog.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import type {
  CreateSubscriptionRequest,
  Invoice,
  Subscription,
  SubscriptionState,
} from '../domain/types.js';
import type { PaymentProviderPort } from '../payment/PaymentProviderPort.js';
import type { InvoiceRepository } from '../persistence/InvoiceRepository.js';
import type { SubscriptionRepository } from '../persistence/SubscriptionRepository.js';
import { transition } from '../domain/SubscriptionStateMachine.js';

export interface CreateSubscriptionResult {
  subscription: Subscription;
  invoice: Invoice | undefined;
}

export class SubscriptionService {
  constructor(
    private readonly plans: PlanCatalog,
    private readonly provider: PaymentProviderPort,
    private readonly subscriptions: SubscriptionRepository,
    private readonly invoices: InvoiceRepository,
  ) {}

  async create(request: CreateSubscriptionRequest): Promise<CreateSubscriptionResult> {
    if (!request || typeof request !== 'object') {
      throw new ValidationError('request body must be an object');
    }
    if (!request.customerId || typeof request.customerId !== 'string') {
      throw new ValidationError('customer_id is required');
    }
    if (!request.paymentMethodId || typeof request.paymentMethodId !== 'string') {
      throw new ValidationError('payment_method_id is required');
    }
    if (!request.plan) {
      throw new ValidationError('plan is required');
    }
    const plan = this.plans.findById(request.plan);
    if (!plan) {
      throw new ValidationError(`unknown plan: ${request.plan}`);
    }

    const now = new Date().toISOString();
    const subscriptionId = `sub_${randomUUID()}`;
    const subscription: Subscription = {
      id: subscriptionId,
      customerId: request.customerId,
      plan: plan.id,
      state: plan.trialDays > 0 ? 'trialing' : 'active',
      paymentMethodId: request.paymentMethodId,
      createdAt: now,
      updatedAt: now,
    };

    let invoice: Invoice | undefined;
    if (plan.trialDays === 0) {
      const charge = await this.provider.charge({
        customerId: request.customerId,
        amount: plan.price,
        currency: plan.currency,
        paymentMethodId: request.paymentMethodId,
        idempotencyKey: `sub_${subscriptionId}`,
      });
      subscription.state = charge.status === 'succeeded' ? 'active' : 'past_due';
      invoice = this.buildInvoice(subscription, charge.status === 'succeeded' ? 'succeeded' : 'failed', charge.providerRef);
    }

    this.subscriptions.upsert(subscription);
    if (invoice) this.invoices.create(invoice);
    return { subscription, invoice };
  }

  get(id: string): Subscription {
    const subscription = this.subscriptions.findById(id);
    if (!subscription) throw new NotFoundError(`subscription not found: ${id}`);
    return subscription;
  }

  cancel(id: string): Subscription {
    const subscription = this.subscriptions.findById(id);
    if (!subscription) throw new NotFoundError(`subscription not found: ${id}`);

    const next = transition(subscription.state, 'cancel');
    if (!next) {
      throw new ConflictError(`cannot cancel a subscription in state ${subscription.state}`);
    }
    subscription.state = next as SubscriptionState;
    subscription.updatedAt = new Date().toISOString();
    this.subscriptions.upsert(subscription);
    return subscription;
  }

  private buildInvoice(subscription: Subscription, status: 'succeeded' | 'failed', providerRef: string): Invoice {
    return {
      id: `inv_${randomUUID()}`,
      subscriptionId: subscription.id,
      invoiceId: `inv_${randomUUID()}`,
      status,
      amount: this.plans.findById(subscription.plan)?.price ?? 0,
      currency: this.plans.findById(subscription.plan)?.currency ?? 'USD',
      providerRef,
      eventId: `local_${randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
  }
}