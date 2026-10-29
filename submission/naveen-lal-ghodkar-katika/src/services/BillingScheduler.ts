import { BillingError } from '../errors';
import { auditEntryFor } from '../domain/AuditEntry';
import { decideBilling } from '../domain/billingSchedule';
import { settleFailure, settleSuccess } from '../domain/chargeSettlement';
import type { InvoiceRecord } from '../domain/Invoice';
import { Subscription } from '../domain/SubscriptionStateMachine';
import type { AuditLogRepository } from '../persistence/AuditLogRepository';
import type { InvoiceRepository } from '../persistence/InvoiceRepository';
import type { SubscriptionRepository } from '../persistence/SubscriptionRepository';
import type { Clock } from '../support/Clock';
import type { IdGenerator } from '../support/IdGenerator';
import type { KeyedMutex } from '../support/KeyedMutex';
import { chargeKeyForAttempt, type BillingService } from './BillingService';

/** One subscription that the billing run charged (or tried to charge). */
export interface BillingRunEntry {
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly attempt: number;
  /** `timeout`: the provider did not answer, the invoice stays pending and is re-sent by a later run. */
  readonly outcome: 'paid' | 'declined' | 'timeout';
}

/**
 * The billing run: charges trial ends, recurring periods and retries when they are due.
 *
 * It decides nothing about timing itself (`decideBilling` does) and nothing about state (the state
 * machine does, via `settleSuccess` / `settleFailure`, the same rules webhooks use). Per subscription:
 * 1. take the subscription's lock (shared with API cancel and webhooks) and re-read everything, so a
 *    cancel or webhook that arrived first is respected and two overlapping runs cannot both charge;
 * 2. save the invoice as `pending` BEFORE calling the provider, so an unanswered charge leaves a
 *    record that a later run (or a webhook) resolves instead of a second invoice;
 * 3. charge; a timeout leaves the invoice pending and the status untouched;
 * 4. write the result: invoice, then subscription, then audit entry.
 *
 * Not one transaction (in-memory repositories). An unexpected provider error propagates and stops the
 * run; the pending invoice it leaves behind is resumed by the next run.
 */
export class BillingScheduler {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly invoices: InvoiceRepository,
    private readonly auditLog: AuditLogRepository,
    private readonly billing: BillingService,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly mutex: KeyedMutex,
  ) {}

  /** Charges everything that is due at the clock's current time, subscription by subscription (by id). */
  async runDue(): Promise<BillingRunEntry[]> {
    const candidates = (await this.subscriptions.list()).map((subscription) => subscription.id).sort();
    const entries: BillingRunEntry[] = [];
    for (const id of candidates) {
      const entry = await this.mutex.runExclusive(id, () => this.billOne(id));
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  }

  private async billOne(subscriptionId: string): Promise<BillingRunEntry | undefined> {
    const stored = await this.subscriptions.findById(subscriptionId);
    if (!stored) {
      return undefined;
    }
    const history = await this.invoices.listBySubscription(subscriptionId);
    const now = this.clock.now();
    const decision = decideBilling(stored, history, now);
    if (decision.action === 'none') {
      return undefined;
    }

    let invoice: InvoiceRecord;
    if (decision.action === 'resume_pending') {
      invoice = decision.invoice;
    } else {
      invoice = this.pendingInvoice(stored.id, stored.priceCents, stored.currency, decision.attempt, now);
      await this.invoices.save(invoice);
    }
    const entry = { subscriptionId, invoiceId: invoice.id, attempt: invoice.attempt };

    let outcome;
    try {
      outcome = await this.billing.chargeInvoice(stored, invoice);
    } catch (error) {
      if (error instanceof BillingError && error.code === 'provider_timeout') {
        return { ...entry, outcome: 'timeout' };
      }
      throw error;
    }

    const succeeded = outcome.trigger === 'charge_succeeded';
    const settled: InvoiceRecord = {
      ...invoice,
      status: succeeded ? 'paid' : 'failed',
      ...(outcome.providerChargeId === undefined ? {} : { providerChargeId: outcome.providerChargeId }),
      ...(outcome.declineCode === undefined ? {} : { declineCode: outcome.declineCode }),
      updatedAt: now.toISOString(),
    };
    const subscription = Subscription.rehydrate(stored);
    const transition = succeeded
      ? settleSuccess(subscription)
      : settleFailure(subscription, [...history.filter((row) => row.id !== settled.id), settled]);

    await this.invoices.save(settled);
    if (transition) {
      await this.subscriptions.save(subscription.toRecord());
      await this.auditLog.append(auditEntryFor(subscriptionId, transition, 'scheduler', now));
    }
    return { ...entry, outcome: succeeded ? 'paid' : 'declined' };
  }

  private pendingInvoice(
    subscriptionId: string,
    amount: number,
    currency: string,
    attempt: number,
    at: Date,
  ): InvoiceRecord {
    const now = at.toISOString();
    return {
      id: this.ids.next('inv'),
      subscriptionId,
      amount,
      currency,
      status: 'pending',
      attempt,
      idempotencyKey: chargeKeyForAttempt(subscriptionId, attempt),
      createdAt: now,
      updatedAt: now,
    };
  }
}
