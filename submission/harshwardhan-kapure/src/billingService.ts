import crypto from 'node:crypto';
import { PaymentProvider } from './paymentProvider';
import { PlanStrategy } from './plans';
import { SubscriptionRepository } from './repository';
import { SubscriptionStateMachine } from './stateMachine';
import {
  ChargeOutcome,
  InvoiceRecord,
  InvoiceStatus,
  SubscriptionRecord,
  SubscriptionTrigger,
  WebhookPayload,
  WebhookProcessingStatus
} from './types';

function nextId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Raised when the payment provider throws an unexpected error after an invoice was persisted.
 */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly subscription: SubscriptionRecord,
    public readonly invoice: InvoiceRecord
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/**
 * Coordinates billing charges, webhook processing, invoice persistence, and state transitions.
 */
export class BillingService {
  private readonly stateMachine = new SubscriptionStateMachine();

  constructor(
    private readonly repository: SubscriptionRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly maxRetries: number = 3
  ) {}

  transitionSubscription(
    sub: SubscriptionRecord,
    trigger: SubscriptionTrigger,
    auditTriggerLabel: string,
    updates: Partial<Pick<SubscriptionRecord, 'retry_count'>> = {}
  ): SubscriptionRecord {
    const nextStatus = this.stateMachine.transition(sub.status, trigger);
    const now = new Date().toISOString();
    const updated: SubscriptionRecord = {
      ...sub,
      ...updates,
      status: nextStatus,
      updated_at: now
    };
    this.repository.saveSubscription(updated);
    this.repository.appendAuditLog({
      id: nextId('aud'),
      subscription_id: sub.id,
      from_status: sub.status,
      to_status: nextStatus,
      trigger: auditTriggerLabel,
      created_at: now
    });
    return updated;
  }

  createInitialSubscription(params: {
    customerId: string;
    plan: PlanStrategy;
    paymentMethodId: string;
  }): SubscriptionRecord {
    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const subscription: SubscriptionRecord = {
      id: nextId('sub'),
      customer_id: params.customerId,
      plan: params.plan.id,
      status: 'trialing',
      payment_method_id: params.paymentMethodId,
      trial_ends_at: params.plan.getTrialEndsAt(nowDate),
      retry_count: 0,
      created_at: nowIso,
      updated_at: nowIso
    };
    this.repository.saveSubscription(subscription);
    this.repository.appendAuditLog({
      id: nextId('aud'),
      subscription_id: subscription.id,
      from_status: null,
      to_status: 'trialing',
      trigger: 'CREATED',
      created_at: nowIso
    });
    return subscription;
  }

  async executeCharge(
    sub: SubscriptionRecord,
    plan: PlanStrategy
  ): Promise<{ subscription: SubscriptionRecord; invoice: InvoiceRecord; outcome: ChargeOutcome }> {
    const now = new Date().toISOString();
    const invoiceId = nextId('inv');
    const pendingInvoice: InvoiceRecord = {
      id: invoiceId,
      subscription_id: sub.id,
      customer_id: sub.customer_id,
      amount: plan.priceCents,
      currency: plan.currency,
      status: 'pending',
      provider_outcome: null,
      idempotency_ref: invoiceId,
      created_at: now,
      updated_at: now
    };
    this.repository.saveInvoice(pendingInvoice);

    let outcome: ChargeOutcome;
    try {
      outcome = await this.paymentProvider.charge(
        sub.customer_id,
        plan.priceCents,
        sub.payment_method_id,
        pendingInvoice.idempotency_ref
      );
    } catch (err) {
      // Ensure partial failure never leaves an orphaned 'pending' invoice.
      const failedInvoice = this.repository.saveInvoice({
        ...pendingInvoice,
        status: 'failed',
        provider_outcome: 'error',
        updated_at: new Date().toISOString()
      });
      const updatedSub = this.applyPaymentFailure(sub, 'BILLING_ERROR');
      const message = err instanceof Error ? err.message : 'Payment provider failed unexpectedly';
      throw new PaymentProviderError(message, updatedSub, failedInvoice);
    }

    const finalizedInvoice = this.repository.saveInvoice({
      ...pendingInvoice,
      status: outcome === 'success' ? 'paid' : 'failed',
      provider_outcome: outcome,
      updated_at: new Date().toISOString()
    });

    const updatedSub =
      outcome === 'success'
        ? this.applyPaymentSuccess(sub, 'BILLING')
        : this.applyPaymentFailure(sub, `BILLING_${outcome.toUpperCase()}`);

    return { subscription: updatedSub, invoice: finalizedInvoice, outcome };
  }

  applyPaymentSuccess(sub: SubscriptionRecord, source: string): SubscriptionRecord {
    if (sub.status === 'trialing') {
      return this.transitionSubscription(sub, 'TRIAL_SUCCEEDED', `${source}_TRIAL_SUCCEEDED`, {
        retry_count: 0
      });
    }
    if (sub.status === 'past_due') {
      return this.transitionSubscription(sub, 'RETRY_SUCCEEDED', `${source}_RETRY_SUCCEEDED`, {
        retry_count: 0
      });
    }
    return sub;
  }

  applyPaymentFailure(sub: SubscriptionRecord, source: string): SubscriptionRecord {
    if (sub.status === 'trialing') {
      return this.transitionSubscription(sub, 'TRIAL_FAILED', `${source}_TRIAL_FAILED`, {
        retry_count: 1
      });
    }
    if (sub.status === 'active') {
      return this.transitionSubscription(sub, 'RECURRING_FAILED', `${source}_RECURRING_FAILED`, {
        retry_count: 1
      });
    }
    if (sub.status === 'past_due') {
      const nextRetries = sub.retry_count + 1;
      if (nextRetries >= this.maxRetries) {
        return this.transitionSubscription(sub, 'RETRIES_EXHAUSTED', `${source}_RETRIES_EXHAUSTED`, {
          retry_count: nextRetries
        });
      }
      return this.repository.saveSubscription({
        ...sub,
        retry_count: nextRetries,
        updated_at: new Date().toISOString()
      });
    }
    return sub;
  }

  recordWebhook(
    payload: WebhookPayload,
    processingStatus: WebhookProcessingStatus,
    reason?: string
  ): void {
    this.repository.saveWebhookEvent({
      id: nextId('whe'),
      event_id: payload.event_id,
      type: payload.type,
      subscription_id: payload.subscription_id,
      invoice_id: payload.invoice_id,
      processing_status: processingStatus,
      reason,
      received_at: new Date().toISOString()
    });
  }

  upsertWebhookInvoice(
    payload: WebhookPayload,
    customerId: string,
    status: InvoiceStatus
  ): InvoiceRecord {
    const now = new Date().toISOString();
    const existing = this.repository.findInvoiceById(payload.invoice_id);
    const invoice: InvoiceRecord = existing
      ? { ...existing, status, provider_outcome: 'webhook', updated_at: now }
      : {
          id: payload.invoice_id,
          subscription_id: payload.subscription_id,
          customer_id: customerId,
          amount: payload.amount,
          currency: payload.currency,
          status,
          provider_outcome: 'webhook',
          idempotency_ref: payload.invoice_id,
          created_at: now,
          updated_at: now
        };
    return this.repository.saveInvoice(invoice);
  }
}
