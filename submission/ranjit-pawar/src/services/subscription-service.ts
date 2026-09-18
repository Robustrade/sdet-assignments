import { iso, type Clock } from '../domain/clock';
import { DomainError } from '../domain/errors';
import type { IdGenerator } from '../domain/ids';
import type { PlanCatalog } from '../domain/plan-policy';
import type { SubscriptionStateMachine } from '../domain/subscription-state-machine';
import type { SubscriptionRecord } from '../persistence/records';
import type { Repositories } from '../persistence/repositories';
import type { BillingEngine } from './billing-engine';

export interface CreateSubscriptionCommand {
  customer_id?: unknown;
  plan?: unknown;
  payment_method_id?: unknown;
}

export interface SubscriptionServiceDeps {
  repos: Repositories;
  plans: PlanCatalog;
  clock: Clock;
  ids: IdGenerator;
  engine: BillingEngine;
  stateMachine: SubscriptionStateMachine;
}

export class SubscriptionService {
  constructor(private readonly deps: SubscriptionServiceDeps) {}

  async create(command: CreateSubscriptionCommand): Promise<SubscriptionRecord> {
    const { repos, plans, clock, ids, engine } = this.deps;

    const customerId = requireString(command.customer_id, 'customer_id');
    const planId = requireString(command.plan, 'plan');
    const paymentMethodId = requireString(command.payment_method_id, 'payment_method_id');

    if (!plans.has(planId)) throw DomainError.invalidPlan(planId);

    const customer = repos.customers.findById(customerId);
    if (!customer) throw DomainError.unknownCustomer(customerId);
    if (!customer.payment_method_ids.includes(paymentMethodId)) {
      throw DomainError.unknownPaymentMethod(paymentMethodId);
    }

    const plan = plans.get(planId);
    const now = clock.now();
    const trialEndsAt = plan.trialEndsAt(now);

    // Every subscription is born `trialing`; a zero-day trial is settled by an
    // immediate charge, so the state machine owns the first transition too.
    const created = repos.subscriptions.insert({
      id: ids.next('sub'),
      customer_id: customerId,
      plan: planId,
      state: 'trialing',
      payment_method_id: paymentMethodId,
      trial_ends_at: trialEndsAt ? iso(trialEndsAt) : null,
      current_period_start: null,
      current_period_end: null,
      retries_remaining: plan.maxPaymentRetries,
      next_retry_at: null,
      created_at: iso(now),
      updated_at: iso(now),
      canceled_at: null
    });

    engine.recordNote(created, plan.startsInTrial() ? 'trial_started' : 'subscription_created', {
      source: 'api'
    });

    if (!plan.startsInTrial()) {
      await engine.attemptCharge(created.id, 'api');
    }

    return repos.subscriptions.requireById(created.id);
  }

  get(id: string): SubscriptionRecord {
    return this.deps.repos.subscriptions.requireById(id);
  }

  cancel(id: string): SubscriptionRecord {
    const { repos, engine } = this.deps;
    const sub = repos.subscriptions.requireById(id);

    const result = engine.applyTrigger(sub.id, 'cancel_requested', { source: 'api' });
    if (!result.ok) {
      // Cancelling an already-canceled subscription (or a past_due one, which the
      // lifecycle diagram does not permit) is rejected, never silently accepted.
      throw DomainError.illegalTransition(result.from, 'cancel_requested');
    }
    engine.voidOpenInvoices(sub.id, 'api');
    return repos.subscriptions.requireById(sub.id);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw DomainError.missingField(field);
  return value;
}
