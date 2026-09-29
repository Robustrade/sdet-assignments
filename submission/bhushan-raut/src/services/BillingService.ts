import type { Clock } from '../clock';
import type { PlanCatalog } from '../domain/PlanCatalog';
import { SubscriptionStateMachine } from '../domain/SubscriptionStateMachine';
import type { SequentialIds } from '../ids';
import type { Notifier } from '../notifier';
import type { BillingRepository } from '../persistence/BillingRepository';
import { inTransaction, type Db } from '../persistence/database';
import type { SubscriptionRecord, SubscriptionRepository } from '../persistence/SubscriptionRepository';
import { ProviderTimeoutError, type PaymentProvider } from '../provider/PaymentProvider';
import type { PaymentOutcome, PaymentOutcomeApplier } from './PaymentOutcomeApplier';

export type BillingRunResult =
  | { kind: 'not_found' }
  | { kind: 'rejected'; code: 'subscription_canceled' | 'charge_in_flight' | 'not_due' }
  | { kind: 'charged'; result: 'succeeded' | 'declined' | 'pending' | 'ignored_invalid_transition'; subscription: SubscriptionRecord };

export class BillingService {
  constructor(
    private readonly db: Db,
    private readonly subscriptions: SubscriptionRepository,
    private readonly billing: BillingRepository,
    private readonly plans: PlanCatalog,
    private readonly provider: PaymentProvider,
    private readonly applier: PaymentOutcomeApplier,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
    private readonly ids: SequentialIds,
  ) {}

  /** One billing attempt for whatever is due: trial end, renewal, or past-due retry. */
  async run(subscriptionId: string): Promise<BillingRunResult> {
    const sub = this.subscriptions.find(subscriptionId);
    if (!sub) return { kind: 'not_found' };
    if (SubscriptionStateMachine.isTerminal(sub.status)) return { kind: 'rejected', code: 'subscription_canceled' };
    // An unanswered charge may still succeed; charging again could bill the customer twice.
    if (this.billing.hasPendingAttempt(sub.id)) return { kind: 'rejected', code: 'charge_in_flight' };
    if (!this.isDue(sub)) return { kind: 'rejected', code: 'not_due' };

    const plan = this.plans.get(sub.plan);
    const now = this.clock.now();

    const { invoice, attempt } = inTransaction(this.db, () => {
      const invoice =
        (sub.status === 'past_due' ? this.billing.latestUnpaidInvoice(sub.id) : undefined) ??
        this.billing.createInvoice(
          { id: this.ids.next('inv'), subscriptionId: sub.id, amount: plan.amount, currency: plan.currency },
          now,
        );
      const attemptNo = this.billing.countAttempts(invoice.id) + 1;
      const attempt = this.billing.insertPendingAttempt(
        { id: this.ids.next('pay'), invoiceId: invoice.id, attemptNo, idempotencyKey: `${invoice.id}:attempt:${attemptNo}` },
        now,
      );
      return { invoice, attempt };
    });

    let outcome: PaymentOutcome;
    try {
      const res = await this.provider.charge({
        customerId: sub.customerId,
        paymentMethodId: sub.paymentMethodId,
        amount: invoice.amount,
        currency: invoice.currency,
        idempotencyKey: attempt.idempotencyKey,
        metadata: { subscriptionId: sub.id, invoiceId: invoice.id },
      });
      outcome =
        res.status === 'succeeded'
          ? { kind: 'succeeded', providerRef: res.providerRef }
          : { kind: 'failed', providerRef: res.providerRef, declineCode: res.declineCode };
    } catch (error) {
      if (!(error instanceof ProviderTimeoutError)) throw error;
      // Outcome unknown: leave the attempt pending; the provider's webhook will settle it.
      return { kind: 'charged', result: 'pending', subscription: this.subscriptions.find(sub.id)! };
    }

    const applied = inTransaction(this.db, () => {
      // Re-read: the subscription may have changed (e.g. canceled) while we awaited the provider.
      const fresh = this.subscriptions.find(sub.id)!;
      return this.applier.apply(fresh, invoice, attempt, outcome, { source: 'billing', reference: attempt.id, at: this.clock.now() });
    });
    if (applied.outcome === 'applied' && applied.activated) this.notifier.subscriptionActivated(sub.id);

    const result =
      applied.outcome === 'ignored_invalid_transition'
        ? 'ignored_invalid_transition'
        : outcome.kind === 'succeeded'
          ? 'succeeded'
          : 'declined';
    return { kind: 'charged', result, subscription: this.subscriptions.find(sub.id)! };
  }

  private isDue(sub: SubscriptionRecord): boolean {
    const now = this.clock.now().getTime();
    switch (sub.status) {
      case 'trialing':
        return now >= Date.parse(sub.trialEndsAt);
      case 'active':
        return sub.currentPeriodEnd !== null && now >= Date.parse(sub.currentPeriodEnd);
      case 'past_due':
        return true;
      case 'canceled':
        return false;
    }
  }
}
