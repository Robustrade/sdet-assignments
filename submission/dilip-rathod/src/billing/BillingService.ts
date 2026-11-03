import type { Invoice, PaymentAttempt, Subscription } from '../domain/types';
import type { PaymentProvider, ChargeResult } from '../payments/PaymentProvider';
import { ProviderTimeoutError } from '../payments/PaymentProvider';
import type { Database } from '../persistence/Database';
import type { InvoiceRepository } from '../persistence/repositories/InvoiceRepository';
import type { PaymentAttemptRepository } from '../persistence/repositories/PaymentAttemptRepository';
import type { SubscriptionRepository } from '../persistence/repositories/SubscriptionRepository';
import type { PlanCatalog } from '../plans/PlanPolicy';
import type { Clock, IdGenerator } from '../shared/infrastructure';
import { iso } from '../shared/infrastructure';
import type { PaymentOutcomeHandler } from './PaymentOutcomeHandler';

export type BillingOutcome =
  | 'succeeded'
  | 'declined'
  | 'pending'
  | 'timed_out'
  | 'resolved_elsewhere'
  | 'ignored'
  | 'skipped_not_due'
  | 'skipped_charge_in_flight';

export interface BillingResult {
  subscriptionId: string;
  invoiceId: string | null;
  outcome: BillingOutcome;
  reason?: string;
}

type PreparedCharge =
  | { kind: 'skip'; result: BillingResult }
  | { kind: 'charge'; subscription: Subscription; invoice: Invoice; attempt: PaymentAttempt };

/**
 * Bills subscriptions whose `next_billing_at` has passed. A charge is three steps:
 *   1. (transaction) find or open the invoice and write the attempt as `pending` — before calling out,
 *      so a webhook that races the response can find it;
 *   2. call the provider (no transaction held across the await);
 *   3. (transaction) apply the response, unless a webhook already resolved the attempt.
 */
export class BillingService {
  constructor(
    private readonly db: Database,
    private readonly subscriptions: SubscriptionRepository,
    private readonly invoices: InvoiceRepository,
    private readonly attempts: PaymentAttemptRepository,
    private readonly outcomes: PaymentOutcomeHandler,
    private readonly provider: PaymentProvider,
    private readonly plans: PlanCatalog,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async runDue(): Promise<BillingResult[]> {
    const due = this.subscriptions.findDueForBilling(iso(this.clock.now()));
    const results: BillingResult[] = [];
    for (const subscription of due) results.push(await this.bill(subscription.id));
    return results;
  }

  async bill(subscriptionId: string): Promise<BillingResult> {
    const prepared = this.db.transaction(() => this.prepare(subscriptionId));
    if (prepared.kind === 'skip') return prepared.result;

    const { subscription, invoice, attempt } = prepared;
    let response: ChargeResult | 'timed_out';
    try {
      response = await this.provider.charge({
        customerId: subscription.customerId,
        paymentMethodId: subscription.paymentMethodId,
        amount: attempt.amount,
        currency: invoice.currency,
        idempotencyKey: attempt.idempotencyKey,
        reference: invoice.id,
      });
    } catch (error) {
      if (!(error instanceof ProviderTimeoutError)) throw error;
      response = 'timed_out';
    }

    return this.db.transaction(() => this.applyResponse(subscriptionId, invoice.id, attempt.id, response));
  }

  private prepare(subscriptionId: string): PreparedCharge {
    const now = this.clock.now();
    const subscription = this.subscriptions.find(subscriptionId);
    const skip = (outcome: BillingOutcome, invoiceId: string | null = null): PreparedCharge => ({
      kind: 'skip',
      result: { subscriptionId, invoiceId, outcome },
    });

    if (!subscription || subscription.status === 'canceled' || !subscription.nextBillingAt || subscription.nextBillingAt > iso(now)) {
      return skip('skipped_not_due');
    }

    let invoice = this.invoices.findOpen(subscription.id);
    if (invoice) {
      // Outcome of the previous call is unknown or still coming: charging again could double-charge.
      if (this.attempts.findUnresolved(invoice.id)) return skip('skipped_charge_in_flight', invoice.id);
    } else {
      const plan = this.plans.require(subscription.plan);
      const period = plan.periodStartingAt(new Date(subscription.nextBillingAt));
      invoice = {
        id: this.ids.next('inv'),
        subscriptionId: subscription.id,
        plan: plan.code,
        amount: plan.priceCents,
        currency: plan.currency,
        status: 'open',
        periodStart: iso(period.start),
        periodEnd: iso(period.end),
        createdAt: iso(now),
        paidAt: null,
        closedAt: null,
      };
      this.invoices.insert(invoice);
    }

    const attemptNumber = this.attempts.nextAttemptNumber(invoice.id);
    const attempt: PaymentAttempt = {
      id: this.ids.next('pa'),
      invoiceId: invoice.id,
      attemptNumber,
      idempotencyKey: `${invoice.id}:${attemptNumber}`,
      amount: invoice.amount,
      status: 'pending',
      providerChargeId: null,
      declineCode: null,
      resolvedBy: null,
      createdAt: iso(now),
      resolvedAt: null,
    };
    this.attempts.insert(attempt);
    return { kind: 'charge', subscription, invoice, attempt };
  }

  private applyResponse(subscriptionId: string, invoiceId: string, attemptId: string, response: ChargeResult | 'timed_out'): BillingResult {
    const result = (outcome: BillingOutcome, reason?: string): BillingResult => ({ subscriptionId, invoiceId, outcome, ...(reason && { reason }) });
    const attempt = this.attempts.find(attemptId)!;
    if (attempt.status !== 'pending') return result('resolved_elsewhere');
    const invoice = this.invoices.find(invoiceId)!;

    if (response === 'timed_out') {
      this.attempts.markTimedOut(attempt.id);
      return result('timed_out');
    }
    if (response.status === 'pending') {
      this.attempts.recordProviderChargeId(attempt.id, response.chargeId);
      return result('pending');
    }

    const ctx = { source: 'provider_response' as const, providerChargeId: response.chargeId, reference: invoice.id };
    const outcome =
      response.status === 'succeeded'
        ? this.outcomes.recordSuccess(invoice, attempt, ctx)
        : this.outcomes.recordFailure(invoice, attempt, response.declineCode, ctx);
    return outcome.applied ? result(response.status) : result('ignored', outcome.reason);
  }
}
