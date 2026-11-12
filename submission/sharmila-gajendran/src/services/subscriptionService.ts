import type { Clock } from '../domain/clock';
import { BusinessRuleError } from '../domain/errors';
import type { IdGenerator } from '../domain/ids';
import type { PlanCatalog } from '../domain/plans';
import type { Subscription } from '../domain/types';
import { inTransaction, type Db } from '../persistence/database';
import type { Repositories } from '../persistence/repositories';
import type { BillingService } from './billingService';
import type { SubscriptionLifecycle } from './subscriptionLifecycle';

export interface CreateSubscriptionInput {
  readonly customerId: string;
  readonly plan: string;
  readonly paymentMethodId: string;
}

export class SubscriptionService {
  constructor(
    private readonly db: Db,
    private readonly repos: Repositories,
    private readonly plans: PlanCatalog,
    private readonly lifecycle: SubscriptionLifecycle,
    private readonly billing: BillingService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /** Validates everything before saving anything, so a rejected request leaves no trace. */
  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    const plan = this.plans.find(input.plan);
    if (!plan) {
      throw new BusinessRuleError(`Unknown plan '${input.plan}'`, 'UNKNOWN_PLAN');
    }
    const customer = this.repos.customers.findById(input.customerId);
    if (!customer) {
      throw new BusinessRuleError(`Customer '${input.customerId}' does not exist`, 'CUSTOMER_NOT_FOUND');
    }
    const paymentMethod = this.repos.paymentMethods.findById(input.paymentMethodId);
    if (!paymentMethod || paymentMethod.customerId !== customer.id) {
      throw new BusinessRuleError(
        `Payment method '${input.paymentMethodId}' does not belong to customer '${customer.id}'`,
        'INVALID_PAYMENT_METHOD',
      );
    }

    const now = this.clock.now();
    const id = this.ids.next('sub');
    const created = inTransaction(this.db, () => {
      this.repos.subscriptions.insertTrialing({
        id,
        customerId: customer.id,
        paymentMethodId: paymentMethod.id,
        plan: plan.code,
        trialEndsAt: plan.trialEndsAt(now).toISOString(),
        createdAt: now.toISOString(),
      });
      const subscription = this.repos.subscriptions.getById(id);
      this.lifecycle.recordCreated(subscription, { source: 'api', reference: null });
      return subscription;
    });

    // A plan without a trial is charged straight away, so it leaves this request as active or past_due.
    if (plan.chargesOnCreate()) {
      await this.billing.attemptCharge(created, 'api');
    }
    return this.repos.subscriptions.getById(id);
  }

  get(id: string): Subscription {
    return this.repos.subscriptions.getById(id);
  }

  cancel(id: string): Subscription {
    return inTransaction(this.db, () => {
      const subscription = this.repos.subscriptions.getById(id);
      return this.lifecycle.apply(
        subscription,
        'cancel_requested',
        { source: 'api', reference: null },
        { canceledAt: this.clock.now().toISOString() },
      );
    });
  }
}
