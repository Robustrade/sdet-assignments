import { createHmac, timingSafeEqual } from 'node:crypto';
import { CreateSubscriptionRequest, PaymentEventType, Subscription, SubscriptionStatus, WebhookEvent } from '../domain/models';
import { SubscriptionStateMachine, TransitionTrigger } from '../domain/stateMachine';
import { PaymentProvider } from '../infrastructure/paymentProvider';
import { Repository } from '../infrastructure/repository';

export class SubscriptionService {
  private sequence = 0;
  private readonly webhookSecret: string;
  constructor(private readonly repo: Repository, private readonly provider: PaymentProvider, private readonly stateMachine: SubscriptionStateMachine, webhookSecret = 'test-secret') {
    this.webhookSecret = webhookSecret;
  }

  reset(): void { this.sequence = 0; }

  async create(request: CreateSubscriptionRequest): Promise<{ status: number; body: any }> {
    if (!request.customerId || !request.plan || !request.paymentMethodId) return this.error(400, 'customerId, plan and paymentMethodId are required');
    if (!this.repo.getCustomer(request.customerId)) return this.error(404, 'Unknown customer');
    const plan = this.repo.getPlan(request.plan);
    if (!plan) return this.error(400, 'Unknown plan');

    const id = `sub_${++this.sequence}`;
    const now = new Date().toISOString();
    const subscription: Subscription = {
      id, customerId: request.customerId, plan: request.plan, paymentMethodId: request.paymentMethodId,
      status: plan.trialDays > 0 ? 'trialing' : 'active', trialEndsAt: plan.trialDays > 0 ? new Date(Date.now() + plan.trialDays * 86400000).toISOString() : null,
      createdAt: now, updatedAt: now
    };
    this.repo.saveSubscription(subscription);

    if (plan.trialDays === 0) {
      const invoiceId = `inv_${this.sequence}`;
      try {
        const result = await this.provider.charge({ customerId: subscription.customerId, paymentMethodId: subscription.paymentMethodId, amountCents: plan.priceCents, currency: 'USD', reference: invoiceId });
        if (result.outcome === 'timeout') throw new Error('PAYMENT_PROVIDER_TIMEOUT');
        const toStatus: SubscriptionStatus = result.outcome === 'success' ? 'active' : 'past_due';
        const updated = { ...subscription, status: toStatus, updatedAt: new Date().toISOString() };
        this.repo.saveSubscription(updated);
        this.repo.saveInvoice({ id: invoiceId, subscriptionId: subscription.id, amountCents: plan.priceCents, currency: 'USD', status: result.outcome === 'success' ? 'succeeded' : 'failed', providerReference: result.providerReference, createdAt: updated.updatedAt });
        this.repo.addAuditEvent({ id: `audit_${Date.now()}_${Math.random()}`, subscriptionId: subscription.id, event: 'immediate_charge', fromStatus: null, toStatus: updated.status, referenceId: invoiceId, createdAt: updated.updatedAt });
        return { status: 201, body: updated };
      } catch (e) {
        if (e instanceof Error && e.message === 'PAYMENT_PROVIDER_TIMEOUT') return this.error(504, 'Payment provider timeout');
        throw e;
      }
    }
    return { status: 201, body: subscription };
  }

  get(id: string): { status: number; body: any } {
    const subscription = this.repo.getSubscription(id);
    return subscription ? { status: 200, body: subscription } : this.error(404, 'Subscription not found');
  }

  cancel(id: string): { status: number; body: any } {
    const subscription = this.repo.getSubscription(id);
    if (!subscription) return this.error(404, 'Subscription not found');
    if (!this.stateMachine.canTransition(subscription.status, 'customer_cancel')) return this.error(409, 'Subscription is already canceled');
    const updated = this.move(subscription, 'customer_cancel');
    this.repo.saveSubscription(updated);
    return { status: 200, body: updated };
  }


  changePlan(id: string, planCode: string): { status: number; body: any } {
    const subscription = this.repo.getSubscription(id);
    if (!subscription) return this.error(404, 'Subscription not found');
    if (subscription.status === 'canceled') return this.error(409, 'Canceled subscription cannot change plan');
    const plan = this.repo.getPlan(planCode as any);
    if (!plan) return this.error(400, 'Unknown plan');
    const updated = { ...subscription, plan: plan.code, trialEndsAt: subscription.status === 'trialing' ? new Date(Date.now() + plan.trialDays * 86400000).toISOString() : subscription.trialEndsAt, updatedAt: new Date().toISOString() };
    this.repo.saveSubscription(updated);
    this.repo.addAuditEvent({ id: `audit_${Date.now()}_${Math.random()}`, subscriptionId: id, event: 'plan_changed', fromStatus: subscription.status, toStatus: updated.status, referenceId: plan.code, createdAt: updated.updatedAt });
    return { status: 200, body: updated };
  }

  async chargeForSubscription(id: string, outcomeTrigger: 'trial_charge_succeeded'|'trial_charge_failed'|'recurring_charge_failed'|'retry_charge_succeeded'|'retries_exhausted'): Promise<{status:number;body:any}> {
    const subscription = this.repo.getSubscription(id);
    if (!subscription) return this.error(404, 'Subscription not found');
    const plan = this.repo.getPlan(subscription.plan)!;
    const invoiceId = `inv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    return this.chargeAndApply(subscription, invoiceId, outcomeTrigger, plan.priceCents);
  }

  webhook(rawBody: string, signature: string | undefined): { status: number; body: any } {
    if (!signature) return this.error(401, 'Missing webhook signature');
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return this.error(401, 'Invalid webhook signature');
    let payload: any;
    try { payload = JSON.parse(rawBody); } catch { return this.error(400, 'Malformed JSON payload'); }
    if (!payload.event_id || !payload.type || !payload.subscription_id || !payload.invoice_id || typeof payload.amount !== 'number') return this.error(400, 'Malformed webhook payload');
    const subscription = this.repo.getSubscription(payload.subscription_id);
    if (!subscription) return this.error(404, 'Subscription not found');
    const type = payload.type as PaymentEventType;
    if (!['payment.succeeded', 'payment.failed', 'payment.refunded'].includes(type)) return this.error(400, 'Unsupported webhook type');

    const event: WebhookEvent = { eventId: payload.event_id, type, subscriptionId: payload.subscription_id, invoiceId: payload.invoice_id, amountCents: payload.amount, currency: payload.currency ?? 'USD', processed: false, createdAt: new Date().toISOString() };
    if (!this.repo.saveWebhookEvent(event)) return { status: 200, body: { processed: false, duplicate: true } };

    const existingInvoice = this.repo.getInvoice(payload.invoice_id);
    if (existingInvoice?.status === 'succeeded' && type === 'payment.failed') {
      const processed = this.repo.getWebhookEvent(payload.event_id)!;
      this.repo.saveWebhookEvent({ ...processed, processed: true });
      return { status: 200, body: { processed: false, ignored: true, reason: 'stale_event' } };
    }

    if (subscription.status === 'canceled') {
      const processed = this.repo.getWebhookEvent(payload.event_id)!;
      this.repo.saveWebhookEvent({ ...processed, processed: true });
      return { status: 200, body: { processed: false, ignored: true, reason: 'subscription_canceled' } };
    }
    if (type === 'payment.succeeded') {
      const current = this.repo.getSubscription(payload.subscription_id)!;
      const trigger: TransitionTrigger = current.status === 'trialing' ? 'trial_charge_succeeded' : 'retry_charge_succeeded';
      if (!this.stateMachine.canTransition(current.status, trigger)) return { status: 200, body: { processed: false, ignored: true } };
      const updated = this.move(current, trigger);
      this.repo.saveSubscription(updated);
      this.repo.saveInvoice({ id: payload.invoice_id, subscriptionId: updated.id, amountCents: payload.amount, currency: event.currency, status: 'succeeded', providerReference: `webhook_${payload.event_id}`, createdAt: event.createdAt });
    } else if (type === 'payment.failed') {
      const current = this.repo.getSubscription(payload.subscription_id)!;
      const trigger: TransitionTrigger = current.status === 'trialing' ? 'trial_charge_failed' : 'recurring_charge_failed';
      if (!this.stateMachine.canTransition(current.status, trigger)) return { status: 200, body: { processed: false, ignored: true } };
      const updated = this.move(current, trigger);
      this.repo.saveSubscription(updated);
      this.repo.saveInvoice({ id: payload.invoice_id, subscriptionId: updated.id, amountCents: payload.amount, currency: event.currency, status: 'failed', providerReference: `webhook_${payload.event_id}`, createdAt: event.createdAt });
    } else {
      const invoice = this.repo.getInvoice(payload.invoice_id);
      if (invoice) this.repo.saveInvoice({ ...invoice, status: 'refunded' });
    }
    const processed = this.repo.getWebhookEvent(payload.event_id)!;
    this.repo.saveWebhookEvent({ ...processed, processed: true });
    return { status: 200, body: { processed: true } };
  }

  private async chargeAndApply(subscription: Subscription, invoiceId: string, trigger: TransitionTrigger, amountCents: number): Promise<{status:number;body:any}> {
    try {
      const result = await this.provider.charge({ customerId: subscription.customerId, paymentMethodId: subscription.paymentMethodId, amountCents, currency: 'USD', reference: invoiceId });
      const updated = result.outcome === 'success' ? this.move(subscription, trigger) : this.move(subscription, trigger === 'trial_charge_succeeded' ? 'trial_charge_failed' : trigger === 'retry_charge_succeeded' ? 'recurring_charge_failed' : trigger);
      this.repo.saveSubscription(updated);
      this.repo.saveInvoice({ id: invoiceId, subscriptionId: subscription.id, amountCents, currency: 'USD', status: result.outcome === 'success' ? 'succeeded' : 'failed', providerReference: result.providerReference, createdAt: new Date().toISOString() });
      return { status: 201, body: updated };
    } catch (e) {
      if (e instanceof Error && e.message === 'PAYMENT_PROVIDER_TIMEOUT') return this.error(504, 'Payment provider timeout');
      throw e;
    }
  }

  private move(subscription: Subscription, trigger: TransitionTrigger): Subscription {
    const to = this.stateMachine.transition(subscription.status, trigger);
    const updated = { ...subscription, status: to, updatedAt: new Date().toISOString() };
    this.repo.addAuditEvent({ id: `audit_${Date.now()}_${Math.random()}`, subscriptionId: subscription.id, event: trigger, fromStatus: subscription.status, toStatus: to, referenceId: null, createdAt: updated.updatedAt });
    return updated;
  }

  private error(status: number, message: string) { return { status, body: { error: message } }; }
}
