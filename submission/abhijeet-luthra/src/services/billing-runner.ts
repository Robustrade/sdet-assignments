import { Clock } from '../clock';
import { TransactionRunner } from '../db/database';
import { isUnresolved } from '../domain/payment-state-machine';
import { Repositories } from '../repositories';
import { BillingService } from './billing-service';

/**
 * Replaces a real scheduler (assumption A-05): tests call `runDue()` after
 * moving the fake clock, which makes time-based transitions deterministic.
 *
 * For each non-canceled subscription it does at most ONE charge per run:
 *  - trialing whose trial has ended  -> first invoice + attempt 1   (T1/T2)
 *  - active whose period has ended   -> renewal invoice + attempt 1 (T3)
 *  - past_due                        -> retry: attempt n+1          (T4/T5)
 * It never creates an attempt while the invoice has an unresolved one
 * (`pending`/`timed_out`), so a timeout is never automatically re-charged.
 */
export class BillingRunner {
  constructor(
    private readonly repos: Repositories,
    private readonly tx: TransactionRunner,
    private readonly clock: Clock,
    private readonly billing: BillingService,
    private readonly maxAttemptsPerInvoice: number,
  ) {}

  async runDue(): Promise<{ chargesAttempted: number }> {
    const now = this.clock.now().toISOString();
    let chargesAttempted = 0;

    for (const subscription of this.repos.subscriptions.findAll()) {
      if (subscription.status === 'canceled') continue; // cancellation stops future billing

      const paymentId = this.tx(() => {
        const plan = this.repos.plans.findById(subscription.planId)!;
        const open = this.repos.invoices.findOpenBySubscription(subscription.id);
        if (open) {
          const attempts = this.repos.payments.findByInvoice(open.id);
          if (attempts.some((a) => isUnresolved(a.status))) return null; // wait for reconciliation
          if (subscription.status !== 'past_due') return null;
          const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1].attemptNumber : 0;
          if (lastAttempt >= this.maxAttemptsPerInvoice) return null;
          return this.billing.createAttempt(open, lastAttempt + 1).id;
        }
        const dueAt =
          subscription.status === 'trialing'
            ? subscription.trialEnd
            : subscription.status === 'active'
              ? subscription.currentPeriodEnd
              : null;
        if (!dueAt || dueAt > now) return null;
        const invoice = this.billing.createInvoice(subscription, plan, dueAt);
        return this.billing.createAttempt(invoice, 1).id;
      });

      if (paymentId) {
        chargesAttempted++;
        await this.billing.executeCharge(paymentId);
      }
    }
    return { chargesAttempted };
  }
}
