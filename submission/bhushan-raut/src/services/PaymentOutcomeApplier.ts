import { nextPeriodEnd } from '../domain/PlanCatalog';
import { SubscriptionStateMachine, type Trigger } from '../domain/SubscriptionStateMachine';
import type { AttemptRecord, BillingRepository, InvoiceRecord } from '../persistence/BillingRepository';
import type { ChangeContext, SubscriptionRecord, SubscriptionRepository } from '../persistence/SubscriptionRepository';

export const MAX_RETRIES = 3;

export type PaymentOutcome =
  | { kind: 'succeeded'; providerRef: string }
  | { kind: 'failed'; providerRef: string; declineCode: string };

export type ApplyResult = { outcome: 'applied'; activated: boolean } | { outcome: 'ignored_invalid_transition' };

/**
 * The single place where a charge outcome becomes persisted state, whether the outcome
 * came back synchronously from the provider or later by webhook. Must run inside a
 * transaction; it writes nothing when the lifecycle forbids the change.
 */
export class PaymentOutcomeApplier {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly billing: BillingRepository,
  ) {}

  apply(
    sub: SubscriptionRecord,
    invoice: InvoiceRecord,
    attempt: AttemptRecord,
    outcome: PaymentOutcome,
    ctx: ChangeContext,
  ): ApplyResult {
    return outcome.kind === 'succeeded'
      ? this.succeeded(sub, invoice, attempt, outcome, ctx)
      : this.failed(sub, invoice, attempt, outcome, ctx);
  }

  private succeeded(
    sub: SubscriptionRecord,
    invoice: InvoiceRecord,
    attempt: AttemptRecord,
    outcome: Extract<PaymentOutcome, { kind: 'succeeded' }>,
    ctx: ChangeContext,
  ): ApplyResult {
    const periodEnd = nextPeriodEnd(ctx.at);

    if (sub.status === 'active') {
      // Renewal paid: bookkeeping only, no lifecycle change.
      this.recordPayment(invoice, attempt, outcome, ctx);
      this.subscriptions.updateBillingFields(sub.id, { currentPeriodEnd: periodEnd }, ctx.at);
      return { outcome: 'applied', activated: false };
    }

    const trigger: Trigger = sub.status === 'trialing' ? 'TRIAL_CHARGE_SUCCEEDED' : 'RETRY_SUCCEEDED';
    const result = SubscriptionStateMachine.apply(sub.status, trigger);
    if (!result.ok) return { outcome: 'ignored_invalid_transition' };

    this.recordPayment(invoice, attempt, outcome, ctx);
    this.subscriptions.applyTransition(sub.id, result.transition, ctx, { retryCount: 0, currentPeriodEnd: periodEnd });
    return { outcome: 'applied', activated: true };
  }

  private failed(
    sub: SubscriptionRecord,
    invoice: InvoiceRecord,
    attempt: AttemptRecord,
    outcome: Extract<PaymentOutcome, { kind: 'failed' }>,
    ctx: ChangeContext,
  ): ApplyResult {
    if (sub.status === 'past_due') {
      const retryCount = sub.retryCount + 1;
      if (retryCount < MAX_RETRIES) {
        this.recordFailure(invoice, attempt, outcome, ctx);
        this.subscriptions.updateBillingFields(sub.id, { retryCount }, ctx.at);
        return { outcome: 'applied', activated: false };
      }
      const exhausted = SubscriptionStateMachine.apply(sub.status, 'RETRIES_EXHAUSTED');
      if (!exhausted.ok) return { outcome: 'ignored_invalid_transition' };
      this.recordFailure(invoice, attempt, outcome, ctx);
      this.subscriptions.applyTransition(sub.id, exhausted.transition, ctx, { retryCount });
      return { outcome: 'applied', activated: false };
    }

    const trigger: Trigger = sub.status === 'trialing' ? 'TRIAL_CHARGE_FAILED' : 'RENEWAL_CHARGE_FAILED';
    const result = SubscriptionStateMachine.apply(sub.status, trigger);
    if (!result.ok) return { outcome: 'ignored_invalid_transition' };

    this.recordFailure(invoice, attempt, outcome, ctx);
    this.subscriptions.applyTransition(sub.id, result.transition, ctx, { retryCount: 0 });
    return { outcome: 'applied', activated: false };
  }

  private recordPayment(
    invoice: InvoiceRecord,
    attempt: AttemptRecord,
    outcome: Extract<PaymentOutcome, { kind: 'succeeded' }>,
    ctx: ChangeContext,
  ): void {
    this.billing.resolveAttempt(attempt.id, { status: 'succeeded', providerRef: outcome.providerRef }, ctx.at);
    this.billing.setInvoiceStatus(invoice.id, 'paid', ctx.at);
  }

  private recordFailure(
    invoice: InvoiceRecord,
    attempt: AttemptRecord,
    outcome: Extract<PaymentOutcome, { kind: 'failed' }>,
    ctx: ChangeContext,
  ): void {
    this.billing.resolveAttempt(
      attempt.id,
      { status: 'failed', providerRef: outcome.providerRef, declineCode: outcome.declineCode },
      ctx.at,
    );
    this.billing.setInvoiceStatus(invoice.id, 'failed', ctx.at);
  }
}
