import type { BillingService } from '../billing/BillingService';
import type { SubscriptionLifecycle } from '../domain/SubscriptionLifecycle';
import { SubscriptionStateMachine } from '../domain/SubscriptionStateMachine';
import type { Invoice, Subscription } from '../domain/types';
import type { Database } from '../persistence/Database';
import type { CustomerRepository } from '../persistence/repositories/CustomerRepository';
import type { AuditLogRepository } from '../persistence/repositories/EventRepositories';
import type { InvoiceRepository } from '../persistence/repositories/InvoiceRepository';
import type { SubscriptionRepository } from '../persistence/repositories/SubscriptionRepository';
import type { PlanCatalog, PlanPolicy } from '../plans/PlanPolicy';
import { ConflictError, NotFoundError, UnprocessableError } from '../shared/errors';
import type { Clock, IdGenerator } from '../shared/infrastructure';
import { iso } from '../shared/infrastructure';

export interface CreateSubscriptionInput {
  customerId: string;
  plan: string;
  paymentMethodId: string;
}

export class SubscriptionService {
  constructor(
    private readonly db: Database,
    private readonly customers: CustomerRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly invoices: InvoiceRepository,
    private readonly audit: AuditLogRepository,
    private readonly lifecycle: SubscriptionLifecycle,
    private readonly billing: BillingService,
    private readonly plans: PlanCatalog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Every subscription starts `trialing`. For a plan without a trial the trial ends now, and the
   * first charge runs before responding — so the result is `active` or `past_due` via the normal edges.
   */
  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    const plan = this.requirePlan(input.plan);
    if (!this.customers.find(input.customerId)) throw new UnprocessableError('unknown_customer', `Customer ${input.customerId} does not exist`);
    const method = this.customers.findPaymentMethod(input.paymentMethodId);
    if (!method || method.customerId !== input.customerId) {
      throw new UnprocessableError('invalid_payment_method', `Payment method ${input.paymentMethodId} is not usable by this customer`);
    }

    const now = this.clock.now();
    const trialEndsAt = plan.trialEndsAt(now);
    const subscription: Subscription = {
      id: this.ids.next('sub'),
      customerId: input.customerId,
      paymentMethodId: input.paymentMethodId,
      plan: plan.code,
      status: SubscriptionStateMachine.initialStatus,
      trialEndsAt: trialEndsAt && iso(trialEndsAt),
      currentPeriodStart: null,
      currentPeriodEnd: null,
      nextBillingAt: iso(trialEndsAt ?? now),
      retryCount: 0,
      canceledAt: null,
      cancelReason: null,
      createdAt: iso(now),
      updatedAt: iso(now),
    };

    this.db.transaction(() => {
      this.subscriptions.insert(subscription);
      this.audit.append({
        subscriptionId: subscription.id,
        eventType: 'created',
        fromStatus: null,
        toStatus: subscription.status,
        cause: 'api',
        reference: null,
        detail: plan.code,
        atIso: subscription.createdAt,
      });
    });

    if (trialEndsAt === null) await this.billing.bill(subscription.id);
    return this.subscriptions.find(subscription.id)!;
  }

  get(id: string): Subscription {
    const subscription = this.subscriptions.find(id);
    if (!subscription) throw new NotFoundError('subscription', id);
    return subscription;
  }

  latestInvoice(id: string): Invoice | undefined {
    return this.invoices.listFor(id).at(-1);
  }

  listInvoices(id: string): Invoice[] {
    this.get(id);
    return this.invoices.listFor(id);
  }

  /** Cancels immediately. Any charge still awaiting an outcome is voided so it can never reactivate. */
  cancel(id: string): Subscription {
    return this.db.transaction(() => {
      const subscription = this.get(id);
      const at = iso(this.clock.now());
      const open = this.invoices.findOpen(id);
      if (open) this.invoices.close(open.id, 'void', at);
      // Throws IllegalTransitionError for past_due/canceled, rolling the void back with it.
      return this.lifecycle.apply(
        subscription,
        'cancel_requested',
        { canceledAt: at, cancelReason: 'customer_request', nextBillingAt: null },
        null,
        at,
      );
    });
  }

  /** Takes effect from the next invoice; no proration. */
  changePlan(id: string, planCode: string): Subscription {
    const plan = this.requirePlan(planCode);
    return this.db.transaction(() => {
      const subscription = this.get(id);
      if (!SubscriptionStateMachine.allowsPlanChange(subscription.status)) {
        throw new ConflictError('plan_change_not_allowed', `Cannot change plan of a ${subscription.status} subscription`);
      }
      if (subscription.plan === plan.code) throw new ConflictError('plan_unchanged', `Subscription is already on ${plan.code}`);
      const at = iso(this.clock.now());
      const updated = this.subscriptions.update(subscription, { plan: plan.code }, at);
      this.audit.append({
        subscriptionId: id,
        eventType: 'plan_changed',
        fromStatus: subscription.status,
        toStatus: subscription.status,
        cause: 'api',
        reference: null,
        detail: `${subscription.plan}->${plan.code}`,
        atIso: at,
      });
      return updated;
    });
  }

  private requirePlan(code: string): PlanPolicy {
    const plan = this.plans.find(code);
    if (!plan) throw new UnprocessableError('unknown_plan', `Plan '${code}' does not exist`);
    return plan;
  }
}
