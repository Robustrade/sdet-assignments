import type { Clock } from '../domain/clock';
import type { IdGenerator } from '../domain/ids';
import type { PlanCatalog } from '../domain/plans';
import type { ChangeSource, Subscription } from '../domain/types';
import { inTransaction, type Db } from '../persistence/database';
import type { Repositories } from '../persistence/repositories';
import type { ChargeResult, PaymentProvider } from '../providers/paymentProvider';
import type { PaymentSettlement } from './paymentSettlement';
import type { ChangeContext } from './subscriptionLifecycle';

export class BillingService {
  constructor(
    private readonly db: Db,
    private readonly repos: Repositories,
    private readonly plans: PlanCatalog,
    private readonly provider: PaymentProvider,
    private readonly settlement: PaymentSettlement,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Stands in for a scheduler: charges every subscription whose trial or period has ended,
   * and makes one retry for every past_due subscription. Returns how many charges were attempted.
   */
  async runDueCharges(): Promise<number> {
    const due = this.repos.subscriptions.findDueForBilling(this.clock.now().toISOString());
    let attempted = 0;
    for (const subscription of due) {
      if (await this.attemptCharge(subscription, 'billing')) {
        attempted += 1;
      }
    }
    return attempted;
  }

  /**
   * One billing attempt = one invoice = one provider call.
   * Returns false (and does nothing) while an earlier attempt's result is still unknown.
   */
  async attemptCharge(subscription: Subscription, source: ChangeSource): Promise<boolean> {
    if (this.repos.invoices.findPendingBySubscription(subscription.id)) {
      return false;
    }

    const plan = this.plans.get(subscription.plan);
    const invoiceId = this.ids.next('inv');
    this.repos.invoices.insertPending({
      id: invoiceId,
      subscriptionId: subscription.id,
      amountCents: plan.priceCents,
      currency: plan.currency,
      createdAt: this.clock.now().toISOString(),
    });

    let answer: ChargeResult;
    try {
      answer = await this.provider.charge({
        amountCents: plan.priceCents,
        currency: plan.currency,
        customerId: subscription.customerId,
        paymentMethodId: subscription.paymentMethodId,
        idempotencyKey: invoiceId,
        reference: subscription.id,
      });
    } catch {
      // Timeout or network error: we don't know whether the customer was charged.
      // The invoice stays pending and the provider's webhook settles it. We never charge it again.
      return true;
    }

    const result = answer;
    const context: ChangeContext = { source, reference: invoiceId };
    inTransaction(this.db, () => {
      const invoice = this.repos.invoices.getById(invoiceId);
      switch (result.status) {
        case 'succeeded':
          this.settlement.settleSucceeded(invoice, result.chargeId, context);
          break;
        case 'declined':
          this.settlement.settleFailed(invoice, result.chargeId, result.reason, context);
          break;
        case 'pending':
          this.repos.invoices.recordProviderCharge(invoiceId, result.chargeId, this.clock.now().toISOString());
          break;
      }
    });
    return true;
  }
}
