import { addDays, iso, type Clock } from '../domain/clock';
import type { IdGenerator } from '../domain/ids';
import type { PlanCatalog } from '../domain/plan-policy';
import {
  SubscriptionStateMachine,
  triggerForChargeOutcome,
  type LifecycleTrigger,
  type TransitionResult
} from '../domain/subscription-state-machine';
import type { ChangeSource, SubscriptionState } from '../domain/types';
import type { Notifier } from '../notifications/notifier';
import {
  PaymentProviderTimeoutError,
  type ChargeResult,
  type PaymentProvider
} from '../payments/payment-provider';
import type { InvoiceRecord, SubscriptionRecord } from '../persistence/records';
import type { Repositories } from '../persistence/repositories';

export interface BillingEngineDeps {
  repos: Repositories;
  plans: PlanCatalog;
  provider: PaymentProvider;
  clock: Clock;
  ids: IdGenerator;
  stateMachine: SubscriptionStateMachine;
  notifier: Notifier;
}

export interface AuditContext {
  source: ChangeSource;
  invoiceId?: string | null;
  eventId?: string | null;
}

export type ChargeAttemptOutcome =
  | { outcome: 'succeeded'; invoiceId: string; state: SubscriptionState }
  | { outcome: 'declined'; invoiceId: string; state: SubscriptionState; declineCode: string }
  | { outcome: 'timeout'; invoiceId: string; state: SubscriptionState }
  | { outcome: 'skipped'; reason: 'SUBSCRIPTION_CANCELED' | 'AWAITING_PROVIDER_RESULT' };

/**
 * The single writer of subscription state and invoices.
 *
 * Every mutation is: ask the state machine -> persist -> append audit -> notify.
 * No other class in the system assigns `subscription.state`.
 */
export class BillingEngine {
  constructor(private readonly deps: BillingEngineDeps) {}

  applyTrigger(
    subscriptionId: string,
    trigger: LifecycleTrigger,
    ctx: AuditContext
  ): TransitionResult {
    const { repos, plans, stateMachine, clock } = this.deps;
    const sub = repos.subscriptions.requireById(subscriptionId);
    const plan = plans.get(sub.plan);

    const result = stateMachine.transition(sub.state, trigger, {
      retriesRemaining: sub.retries_remaining
    });
    if (!result.ok) return result;

    const now = clock.now();
    const patch: Partial<SubscriptionRecord> = { state: result.to, updated_at: iso(now) };

    if (result.to === 'active') {
      patch.current_period_start = iso(now);
      patch.current_period_end = iso(plan.periodEndFrom(now));
      patch.retries_remaining = plan.maxPaymentRetries;
      patch.next_retry_at = null;
    } else if (result.to === 'past_due') {
      // Entering past_due grants the plan's retry budget; failing again consumes one.
      const remaining =
        result.from === 'past_due' ? sub.retries_remaining - 1 : plan.maxPaymentRetries;
      patch.retries_remaining = Math.max(remaining, 0);
      patch.next_retry_at = iso(addDays(now, plan.retryIntervalDays));
    } else if (result.to === 'canceled') {
      patch.canceled_at = iso(now);
      patch.next_retry_at = null;
      patch.retries_remaining = 0;
    }

    repos.subscriptions.update(sub.id, patch);
    this.recordTransition(sub, result, ctx);

    if (result.to === 'active' && result.from !== 'active') {
      this.notify('subscription_activated', sub, ctx.invoiceId ?? undefined);
    }
    if (result.to === 'past_due') this.notify('payment_failed', sub, ctx.invoiceId ?? undefined);
    if (result.to === 'canceled') this.notify('subscription_canceled', sub, ctx.invoiceId ?? undefined);

    return result;
  }

  /**
   * One billing attempt == one invoice == at most one provider call.
   * A pending invoice (provider timed out) blocks a second attempt so the
   * customer can never be charged twice for the same period.
   */
  async attemptCharge(subscriptionId: string, source: ChangeSource): Promise<ChargeAttemptOutcome> {
    const { repos, plans, provider, stateMachine } = this.deps;
    const sub = repos.subscriptions.requireById(subscriptionId);

    if (stateMachine.isTerminal(sub.state)) {
      return { outcome: 'skipped', reason: 'SUBSCRIPTION_CANCELED' };
    }
    const pending = repos.invoices.findPendingBySubscription(sub.id);
    if (pending) {
      return { outcome: 'skipped', reason: 'AWAITING_PROVIDER_RESULT' };
    }

    const plan = plans.get(sub.plan);
    const invoice = this.openInvoice(sub);

    let result: ChargeResult;
    try {
      result = await provider.charge({
        customerId: sub.customer_id,
        paymentMethodId: sub.payment_method_id,
        amountCents: plan.amountDueCents(),
        currency: plan.currency,
        idempotencyKey: invoice.idempotency_key,
        reference: {
          subscriptionId: sub.id,
          invoiceId: invoice.id,
          attempt: invoice.attempt
        }
      });
    } catch (error) {
      if (error instanceof PaymentProviderTimeoutError) {
        // Invoice stays `pending`; the asynchronous webhook is the tie-breaker.
        this.recordNote(sub, 'charge_attempt_timed_out', { source, invoiceId: invoice.id });
        return { outcome: 'timeout', invoiceId: invoice.id, state: sub.state };
      }
      throw error;
    }

    if (result.outcome === 'succeeded') {
      this.settleInvoice(invoice.id, { status: 'paid', provider_charge_id: result.chargeId });
      this.applyTrigger(sub.id, triggerForChargeOutcome(sub.state, 'succeeded'), {
        source,
        invoiceId: invoice.id
      });
      return {
        outcome: 'succeeded',
        invoiceId: invoice.id,
        state: repos.subscriptions.requireById(sub.id).state
      };
    }

    this.settleInvoice(invoice.id, { status: 'failed', failure_code: result.declineCode });
    this.applyTrigger(sub.id, triggerForChargeOutcome(sub.state, 'failed'), {
      source,
      invoiceId: invoice.id
    });
    return {
      outcome: 'declined',
      invoiceId: invoice.id,
      state: repos.subscriptions.requireById(sub.id).state,
      declineCode: result.declineCode
    };
  }

  openInvoice(sub: SubscriptionRecord): InvoiceRecord {
    const { repos, plans, clock, ids } = this.deps;
    const plan = plans.get(sub.plan);
    const now = clock.now();
    const id = ids.next('inv');
    const attempt = repos.invoices.countBySubscription(sub.id) + 1;
    return repos.invoices.insert({
      id,
      subscription_id: sub.id,
      customer_id: sub.customer_id,
      plan: sub.plan,
      amount_cents: plan.amountDueCents(),
      currency: plan.currency,
      status: 'pending',
      attempt,
      // Stable per invoice: a network retry of the same attempt cannot double-charge.
      idempotency_key: `${sub.id}:${id}`,
      provider_charge_id: null,
      failure_code: null,
      paid_at: null,
      refunded_at: null,
      period_start: iso(now),
      period_end: iso(plan.periodEndFrom(now)),
      created_at: iso(now),
      updated_at: iso(now)
    });
  }

  /**
   * The only way an invoice changes status. Settlement timestamps are stamped
   * here so `paid_at` can never be forgotten at a call site — a refund records
   * `refunded_at` and leaves the evidence of the original payment intact.
   */
  settleInvoice(invoiceId: string, patch: Partial<InvoiceRecord>): InvoiceRecord {
    const at = iso(this.deps.clock.now());
    const stamps: Partial<InvoiceRecord> = {};
    if (patch.status === 'paid') stamps.paid_at = at;
    if (patch.status === 'refunded') stamps.refunded_at = at;
    return this.deps.repos.invoices.update(invoiceId, { ...patch, ...stamps, updated_at: at });
  }

  /** Cancellation stops future billing: open invoices are voided, never charged. */
  voidOpenInvoices(subscriptionId: string, source: ChangeSource): void {
    for (const invoice of this.deps.repos.invoices.findBySubscription(subscriptionId)) {
      if (invoice.status === 'pending') {
        this.settleInvoice(invoice.id, { status: 'void' });
        const sub = this.deps.repos.subscriptions.requireById(subscriptionId);
        this.recordNote(sub, 'invoice_voided', { source, invoiceId: invoice.id });
      }
    }
  }

  recordTransition(
    subBefore: SubscriptionRecord,
    result: Extract<TransitionResult, { ok: true }>,
    ctx: AuditContext
  ): void {
    this.deps.repos.subscriptionEvents.append({
      id: this.deps.ids.next('evt'),
      subscription_id: subBefore.id,
      kind: 'transition',
      transition_id: result.id,
      trigger: result.trigger,
      from_state: result.from,
      to_state: result.to,
      note: null,
      source: ctx.source,
      invoice_id: ctx.invoiceId ?? null,
      event_id: ctx.eventId ?? null,
      occurred_at: iso(this.deps.clock.now())
    });
  }

  recordNote(sub: SubscriptionRecord, note: string, ctx: AuditContext): void {
    this.deps.repos.subscriptionEvents.append({
      id: this.deps.ids.next('evt'),
      subscription_id: sub.id,
      kind: 'note',
      transition_id: null,
      trigger: null,
      from_state: sub.state,
      to_state: sub.state,
      note,
      source: ctx.source,
      invoice_id: ctx.invoiceId ?? null,
      event_id: ctx.eventId ?? null,
      occurred_at: iso(this.deps.clock.now())
    });
  }

  notify(
    type: 'subscription_activated' | 'payment_failed' | 'subscription_canceled' | 'payment_refunded',
    sub: SubscriptionRecord,
    invoiceId?: string
  ): void {
    this.deps.notifier.notify({
      type,
      subscriptionId: sub.id,
      customerId: sub.customer_id,
      invoiceId,
      at: iso(this.deps.clock.now())
    });
  }
}
