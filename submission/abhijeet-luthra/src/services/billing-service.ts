import { addDays, Clock } from '../clock';
import { TransactionRunner } from '../db/database';
import { Invoice, Payment, Plan, Subscription } from '../domain/types';
import { IdGenerator } from '../ids';
import { PaymentProvider, ProviderTimeoutError } from '../providers/payment-provider';
import { Repositories } from '../repositories';
import { PaymentOutcome, PaymentOutcomeApplier } from './payment-outcome-applier';

/**
 * Creates invoices/payment attempts and executes charges.
 *
 * Consistency boundary (design §11) - NOT atomic across provider and database:
 *   Tx A  commit a `pending` attempt with its idempotency key   (createAttempt, caller's tx)
 *   ---   call the provider OUTSIDE any transaction              (executeCharge)
 *   Tx B  apply the outcome in a new transaction                 (executeCharge)
 * If Tx B fails, the attempt stays `pending` and a provider webhook reconciles it.
 */
export class BillingService {
  constructor(
    private readonly repos: Repositories,
    private readonly tx: TransactionRunner,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly provider: PaymentProvider,
    private readonly applier: PaymentOutcomeApplier,
  ) {}

  /** Call inside a transaction. */
  createInvoice(subscription: Subscription, plan: Plan, periodStart: string): Invoice {
    const now = this.clock.now().toISOString();
    const invoice: Invoice = {
      id: this.ids.next('inv'),
      subscriptionId: subscription.id,
      amountMinor: plan.priceMinor,
      currency: plan.currency,
      status: 'open',
      periodStart,
      periodEnd: addDays(periodStart, plan.billingIntervalDays),
      createdAt: now,
      updatedAt: now,
    };
    this.repos.invoices.insert(invoice);
    return invoice;
  }

  /** Call inside a transaction. A retry is a NEW attempt with a NEW idempotency key. */
  createAttempt(invoice: Invoice, attemptNumber: number): Payment {
    const now = this.clock.now().toISOString();
    const payment: Payment = {
      id: this.ids.next('pay'),
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      attemptNumber,
      idempotencyKey: `${invoice.id}:${attemptNumber}`,
      providerReference: null,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
      status: 'pending',
      failureCode: null,
      createdAt: now,
      updatedAt: now,
    };
    this.repos.payments.insert(payment);
    return payment;
  }

  /** Calls the provider exactly once for a committed `pending` attempt, then applies the outcome (Tx B). */
  async executeCharge(paymentId: string): Promise<void> {
    const payment = this.repos.payments.findById(paymentId);
    if (!payment || payment.status !== 'pending') return; // never charge the same attempt twice
    const subscription = this.repos.subscriptions.findById(payment.subscriptionId)!;

    const outcome = await this.callProvider({
      idempotencyKey: payment.idempotencyKey,
      invoiceId: payment.invoiceId,
      customerId: subscription.customerId,
      paymentMethodId: subscription.paymentMethodId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
    });

    this.tx(() => {
      const fresh = this.repos.payments.findById(paymentId)!; // re-read: a webhook may have resolved it meanwhile
      this.applier.apply(fresh, outcome, { trigger: 'billing_charge', referenceId: paymentId });
    });
  }

  private async callProvider(request: Parameters<PaymentProvider['charge']>[0]): Promise<PaymentOutcome> {
    try {
      const result = await this.provider.charge(request);
      return result.outcome === 'succeeded'
        ? { type: 'succeeded', providerReference: result.providerReference }
        : { type: 'failed', providerReference: result.providerReference, failureCode: result.declineCode };
    } catch (error) {
      // Timeout or any transport error: we cannot know whether money moved,
      // so it is recorded as an UNKNOWN outcome - never as a decline.
      return { type: 'timed_out', failureCode: error instanceof ProviderTimeoutError ? 'provider_timeout' : 'provider_error' };
    }
  }
}
