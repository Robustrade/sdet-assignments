import {
  InvalidPaymentMethodError,
  UnknownCustomerError,
  ValidationError,
} from '../domain/errors';
import type { PlanCatalog } from '../domain/plans';
import type { Subscription } from '../domain/types';
import type { Repositories } from '../persistence/repositories';
import type { Clock } from '../ports/Clock';
import type { IdGenerator } from '../ports/IdGenerator';
import type { BillingEngine } from './BillingEngine';
import type { LifecycleManager } from './LifecycleManager';

export interface CreateSubscriptionInput {
  customer_id?: unknown;
  plan?: unknown;
  payment_method_id?: unknown;
}

export class SubscriptionService {
  constructor(
    private readonly repos: Repositories,
    private readonly catalog: PlanCatalog,
    private readonly billing: BillingEngine,
    private readonly lifecycle: LifecycleManager,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    // 1. shape validation (400) - nothing is read or written before this passes
    const missing = (['customer_id', 'plan', 'payment_method_id'] as const).filter(
      (f) => typeof input?.[f] !== 'string' || (input[f] as string).trim() === '',
    );
    if (missing.length) throw new ValidationError('Missing or invalid fields', { fields: missing });
    const { customer_id, plan: planId, payment_method_id } = input as Record<string, string>;

    // 2. business validation (422)
    const plan = this.catalog.get(planId);
    const customer = this.repos.customers.findById(customer_id);
    if (!customer) throw new UnknownCustomerError(customer_id);
    if (!customer.paymentMethodIds.includes(payment_method_id)) {
      throw new InvalidPaymentMethodError(payment_method_id);
    }

    // 3. persist in the initial state. Every subscription starts in `trialing`;
    //    a zero-day trial (pro) is simply "trial ends now" and is charged immediately.
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const sub = this.repos.subscriptions.insert({
      id: this.ids.next('sub'),
      customerId: customer.id,
      plan: plan.id,
      paymentMethodId: payment_method_id,
      status: 'trialing',
      trialEndsAt: plan.trialEndsAt(now).toISOString(),
      currentPeriodEnd: null,
      failedAttempts: 0,
      canceledAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      version: 1,
    });
    this.repos.audit.append({
      subscriptionId: sub.id, action: 'subscription.created', fromStatus: null, toStatus: 'trialing', detail: plan.id, at: nowIso,
    });

    if (plan.trialDays === 0) await this.billing.runDue(sub.id);
    return this.repos.subscriptions.getById(sub.id);
  }

  get(id: string): Subscription {
    return this.repos.subscriptions.getById(id);
  }

  cancel(id: string): Subscription {
    const sub = this.repos.subscriptions.getById(id);
    return this.lifecycle.apply(sub, 'CANCEL', 'api_cancel'); // throws 409 when illegal
  }
}
