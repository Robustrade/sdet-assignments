import { SubscriptionRepository } from '../repositories/SubscriptionRepository';
import { PaymentProvider } from '../infrastructure/PaymentProvider';
import { Subscription } from '../domain/Subscription';
import { PLANS, PlanTier } from '../domain/Plan';

export interface CreateResult {
  subscription?: Subscription;
  error?: string;
  statusCode?: number;
}

/**
 * Application service that orchestrates subscription use-cases.
 * Coordinates domain objects, repository persistence and the payment provider.
 */
export class SubscriptionService {
  constructor(private repo: SubscriptionRepository, private paymentProvider: PaymentProvider) {}

  /**
   * Create a subscription for a customer.
   * Handles initial charging when the plan has no trial period.
   * Returns a `CreateResult` containing the subscription or an error and status code.
   */
  async createSubscription(customerId: string, plan: PlanTier, paymentMethodId: string): Promise<CreateResult> {
    if (!customerId || !plan || !paymentMethodId) {
      return { error: 'Missing required fields', statusCode: 400 };
    }

    if (!(plan in PLANS)) {
      return { error: 'Unknown plan', statusCode: 400 };
    }

    const subId = `sub_${Date.now()}`;
    const planConfig = PLANS[plan];
    const initialState: 'trialing' | 'active' = planConfig.trialDays > 0 ? 'trialing' : 'active';

    const sub = new Subscription(subId, customerId, plan as PlanTier, initialState);
    this.repo.save(sub);
    this.repo.logEvent(`evt_create_${subId}`, sub.id, 'subscription.created', JSON.stringify({ plan, state: sub.state }));

    if (initialState === 'active') {
      try {
        const chargeRes = await this.paymentProvider.charge({
          amount: planConfig.price,
          currency: 'USD',
          customerId,
          paymentMethodId,
          idempotencyKey: `charge_init_${subId}`
        });

        if (!chargeRes.success) {
          sub.paymentFailed();
          this.repo.save(sub);
          const invId = `inv_${Date.now()}`;
          this.repo.saveInvoice(invId, sub.id, planConfig.price, 'failed', 'charge');
          this.repo.logEvent(`evt_charge_failed_${invId}`, sub.id, 'payment.failed', JSON.stringify({ invoiceId: invId }));
          return { subscription: sub, error: 'Payment failed', statusCode: 402 };
        }

        const invId = `inv_${Date.now()}`;
        this.repo.saveInvoice(invId, sub.id, planConfig.price, 'paid', 'charge');
        this.repo.logEvent(`evt_charge_succeeded_${invId}`, sub.id, 'payment.succeeded', JSON.stringify({ invoiceId: invId }));
      } catch (err: any) {
        sub.paymentFailed();
        this.repo.save(sub);
        const invId = `inv_${Date.now()}`;
        this.repo.saveInvoice(invId, sub.id, planConfig.price, 'failed', 'timeout');
        this.repo.logEvent(`evt_charge_timeout_${invId}`, sub.id, 'payment.timeout', JSON.stringify({ invoiceId: invId }));
        return { error: 'Payment provider timeout', statusCode: 502, subscription: sub };
      }
    }

    return { subscription: sub, statusCode: 201 };
  }

  /**
   * Change the plan for a subscription. Persists the updated subscription and logs an event.
   * @throws Error('Not found') if subscription does not exist.
   */
  async changePlan(subscriptionId: string, newPlan: PlanTier) {
    const sub = this.repo.get(subscriptionId);
    if (!sub) throw new Error('Not found');
    sub.changePlan(newPlan);
    this.repo.save(sub);
    this.repo.logEvent(`evt_change_plan_${sub.id}`, sub.id, 'subscription.plan_changed', JSON.stringify({ plan: sub.plan }));
    return sub;
  }

  /**
   * Cancel a subscription immediately and persist the change.
   * @throws Error('Not found') if subscription does not exist.
   */
  cancel(subscriptionId: string) {
    const sub = this.repo.get(subscriptionId);
    if (!sub) throw new Error('Not found');
    sub.cancel();
    this.repo.save(sub);
    this.repo.logEvent(`evt_cancel_${sub.id}`, sub.id, 'subscription.canceled', JSON.stringify({ state: sub.state }));
    return sub;
  }

  /**
   * Handle an inbound webhook payload from the payment provider.
   * Enforces idempotency and records invoices/events via the repository.
   * Returns a result object describing the outcome.
   */
  async handleWebhook(payload: any) {
    const { event_id, type, subscription_id, invoice_id, amount } = payload;
    if (this.repo.isEventProcessed(event_id)) return { status: 'ignored_duplicate' };

    const sub = this.repo.get(subscription_id);
    if (!sub) return { error: 'Subscription not found', statusCode: 404 };

    try {
      if (type === 'payment.succeeded') {
        sub.paymentSucceeded();
        this.repo.saveInvoice(invoice_id, sub.id, amount, 'paid', 'webhook');
        this.repo.logEvent(event_id, sub.id, 'payment.succeeded', JSON.stringify({ invoiceId: invoice_id, amount }));
      } else if (type === 'payment.failed') {
        sub.paymentFailed();
        this.repo.saveInvoice(invoice_id, sub.id, amount, 'failed', 'webhook');
        this.repo.logEvent(event_id, sub.id, 'payment.failed', JSON.stringify({ invoiceId: invoice_id, amount }));
      } else if (type === 'payment.refunded') {
        sub.paymentRefunded();
        this.repo.saveInvoice(invoice_id, sub.id, amount, 'refunded', 'webhook');
        this.repo.logEvent(event_id, sub.id, 'payment.refunded', JSON.stringify({ invoiceId: invoice_id, amount }));
      } else if (type === 'payment.retry_exhausted') {
        sub.expireRetries();
        this.repo.saveInvoice(invoice_id, sub.id, amount, 'failed', 'webhook');
        this.repo.logEvent(event_id, sub.id, 'payment.retry_exhausted', JSON.stringify({ invoiceId: invoice_id, amount }));
      } else {
        return { error: 'Unknown event type', statusCode: 400 };
      }

      this.repo.save(sub);
      this.repo.markEventProcessed(event_id);
      return { status: 'processed' };
    } catch (err: any) {
      this.repo.markEventProcessed(event_id);
      return { status: 'ignored_invalid_transition', reason: err.message };
    }
  }
}
