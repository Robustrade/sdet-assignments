import type { Clock } from '../clock';
import type { PlanCatalog } from '../domain/PlanCatalog';
import { SubscriptionStateMachine } from '../domain/SubscriptionStateMachine';
import type { SequentialIds } from '../ids';
import type { CustomerRepository } from '../persistence/CustomerRepository';
import type { SubscriptionRecord, SubscriptionRepository } from '../persistence/SubscriptionRepository';
import type { BillingService } from './BillingService';

export type CreateResult =
  | { kind: 'created'; subscription: SubscriptionRecord }
  | { kind: 'invalid'; httpStatus: 400 | 422; code: string; field?: string };

export type CancelResult =
  | { kind: 'canceled'; subscription: SubscriptionRecord }
  | { kind: 'not_found' }
  | { kind: 'invalid_transition'; status: string };

const REQUIRED_FIELDS = ['customer_id', 'plan', 'payment_method_id'] as const;

export class SubscriptionService {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly customers: CustomerRepository,
    private readonly plans: PlanCatalog,
    private readonly billing: BillingService,
    private readonly clock: Clock,
    private readonly ids: SequentialIds,
  ) {}

  async create(body: unknown): Promise<CreateResult> {
    if (typeof body !== 'object' || body === null) return { kind: 'invalid', httpStatus: 400, code: 'validation_error' };
    const input = body as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      const value = input[field];
      if (typeof value !== 'string' || value.trim() === '') {
        return { kind: 'invalid', httpStatus: 400, code: 'validation_error', field };
      }
    }
    const customerId = input.customer_id as string;
    const paymentMethodId = input.payment_method_id as string;

    const plan = this.plans.find(input.plan as string);
    if (!plan) return { kind: 'invalid', httpStatus: 422, code: 'unknown_plan', field: 'plan' };
    if (!this.customers.exists(customerId)) {
      return { kind: 'invalid', httpStatus: 422, code: 'unknown_customer', field: 'customer_id' };
    }
    if (!this.customers.paymentMethodBelongsTo(paymentMethodId, customerId)) {
      return { kind: 'invalid', httpStatus: 422, code: 'invalid_payment_method', field: 'payment_method_id' };
    }

    const now = this.clock.now();
    const created = this.subscriptions.create(
      {
        id: this.ids.next('sub'),
        customerId,
        plan: plan.code,
        paymentMethodId,
        trialEndsAt: plan.trialEndsAt(now).toISOString(),
      },
      { source: 'api', reference: null, at: now },
    );

    if (plan.chargesAtSignup) await this.billing.run(created.id);
    return { kind: 'created', subscription: this.subscriptions.find(created.id)! };
  }

  find(id: string): SubscriptionRecord | undefined {
    return this.subscriptions.find(id);
  }

  cancel(id: string): CancelResult {
    const sub = this.subscriptions.find(id);
    if (!sub) return { kind: 'not_found' };
    const result = SubscriptionStateMachine.apply(sub.status, 'CANCEL_REQUESTED');
    if (!result.ok) return { kind: 'invalid_transition', status: sub.status };
    this.subscriptions.applyTransition(id, result.transition, { source: 'api', reference: null, at: this.clock.now() });
    return { kind: 'canceled', subscription: this.subscriptions.find(id)! };
  }
}
