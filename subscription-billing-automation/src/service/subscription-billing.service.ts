import { createHmac, timingSafeEqual } from 'node:crypto';
import { MockPaymentProviderAdapter } from '../adapters/mock-payment-provider.adapter';
import { ChargeOutcome, PaymentProvider } from '../adapters/payment-provider.interface';
import { Invoice, InvoiceStatus } from '../domain/models/invoice.model';
import { PaymentWebhookType, WebhookPayload } from '../domain/models/webhook-event.model';
import { Subscription } from '../domain/models/subscription.model';
import { InvalidTransitionError } from '../domain/state/subscription-state.interface';
import { InvoiceRepository } from '../db/invoice.repository';
import { SubscriptionRepository } from '../db/subscription.repository';
import { WebhookEventRepository } from '../db/webhook-event.repository';

export interface ApiResponse<T = any> {
  statusCode: number;
  body: T;
}

export interface CreateSubscriptionRequest {
  customer_id: string;
  plan: string;
  payment_method_id: string;
}

interface Plan {
  price: number;
  currency: string;
  trialDays: number;
}

const PLANS: Record<string, Plan> = {
  basic: { price: 1900, currency: 'USD', trialDays: 14 },
  pro: { price: 4900, currency: 'USD', trialDays: 0 },
};

export class SubscriptionBillingService {
  readonly subscriptions = new SubscriptionRepository();
  readonly invoices = new InvoiceRepository();
  readonly webhookEvents = new WebhookEventRepository();
  private readonly customers: Set<string>;
  private subscriptionSequence = 0;
  private invoiceSequence = 0;

  constructor(
    readonly paymentProvider: PaymentProvider = new MockPaymentProviderAdapter(),
    readonly webhookSecret = 'test-webhook-secret',
    customers: string[] = ['cust_001'],
  ) {
    this.customers = new Set(customers);
  }

  async dispatch(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    rawBody?: string,
  ): Promise<ApiResponse> {
    if (method === 'POST' && path === '/subscriptions') {
      return this.createSubscription(body);
    }
    if (method === 'POST' && path === '/webhooks/payment-provider') {
      const signature = Object.entries(headers)
        .find(([key]) => key.toLowerCase() === 'x-provider-signature')?.[1];
      return this.receiveWebhook(rawBody, signature);
    }
    const getMatch = path.match(/^\/subscriptions\/([^/]+)$/);
    if (method === 'GET' && getMatch) {
      return this.getSubscription(decodeURIComponent(getMatch[1]));
    }
    const cancelMatch = path.match(/^\/subscriptions\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      return this.cancelSubscription(decodeURIComponent(cancelMatch[1]));
    }
    return { statusCode: 404, body: { error: 'Route not found' } };
  }

  private async createSubscription(body: unknown): Promise<ApiResponse> {
    if (!this.isCreateRequest(body)) {
      return { statusCode: 400, body: { error: 'customer_id, plan and payment_method_id are required' } };
    }
    if (!PLANS[body.plan]) {
      return { statusCode: 400, body: { error: 'Unknown plan' } };
    }
    if (!this.customers.has(body.customer_id)) {
      return { statusCode: 404, body: { error: 'Unknown customer' } };
    }
    if (!/^pm_[A-Za-z0-9_-]+$/.test(body.payment_method_id)) {
      return { statusCode: 400, body: { error: 'Invalid payment method' } };
    }

    const plan = PLANS[body.plan];
    const id = `sub_${++this.subscriptionSequence}`;
    const trialEndsAt = plan.trialDays
      ? new Date(Date.now() + plan.trialDays * 24 * 60 * 60 * 1000).toISOString()
      : null;
    const subscription = new Subscription(id, body.customer_id, body.plan, body.payment_method_id, undefined, trialEndsAt);
    this.subscriptions.save(subscription);

    if (plan.trialDays === 0) {
      const invoiceId = `inv_${++this.invoiceSequence}`;
      const outcome = await this.paymentProvider.charge({
        customerId: body.customer_id,
        paymentMethodId: body.payment_method_id,
        amount: plan.price,
        currency: plan.currency,
        idempotencyKey: `initial-charge:${id}`,
      });
      this.persistCharge(subscription, invoiceId, plan.price, plan.currency, outcome);
    }

    const latest = this.subscriptions.findById(id);
    if (!latest) {
      throw new Error(`Created subscription "${id}" could not be retrieved`);
    }
    return { statusCode: 201, body: this.presentSubscription(latest) };
  }

  private getSubscription(id: string): ApiResponse {
    const subscription = this.subscriptions.findById(id);
    return subscription
      ? { statusCode: 200, body: this.presentSubscription(subscription) }
      : { statusCode: 404, body: { error: 'Subscription not found' } };
  }

  private cancelSubscription(id: string): ApiResponse {
    const subscription = this.subscriptions.findById(id);
    if (!subscription) {
      return { statusCode: 404, body: { error: 'Subscription not found' } };
    }
    try {
      subscription.cancel();
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        return { statusCode: 409, body: { error: error.message } };
      }
      throw error;
    }
    this.subscriptions.save(subscription);
    return { statusCode: 200, body: this.presentSubscription(subscription) };
  }

  private receiveWebhook(rawBody: string | undefined, signature: string | undefined): ApiResponse {
    if (typeof rawBody !== 'string' || !this.isValidSignature(rawBody, signature)) {
      return { statusCode: 401, body: { error: 'Invalid webhook signature' } };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return { statusCode: 400, body: { error: 'Malformed JSON payload' } };
    }
    if (!this.isWebhookPayload(payload)) {
      return { statusCode: 400, body: { error: 'Invalid webhook payload' } };
    }

    const duplicate = this.webhookEvents.findById(payload.event_id);
    if (duplicate) {
      this.webhookEvents.recordDuplicate(payload.event_id);
      return { statusCode: 200, body: { received: true, duplicate: true } };
    }

    const subscription = this.subscriptions.findById(payload.subscription_id);
    if (!subscription) {
      return { statusCode: 404, body: { error: 'Subscription not found' } };
    }
    const existingInvoice = this.invoices.findById(payload.invoice_id);
    if (existingInvoice && (
      existingInvoice.subscriptionId !== payload.subscription_id
      || existingInvoice.amount !== payload.amount
      || existingInvoice.currency !== payload.currency
    )) {
      this.webhookEvents.record(payload.event_id, payload.subscription_id, payload.type, 'ignored');
      return { statusCode: 200, body: { received: true, applied: false } };
    }
    if (subscription.status === 'canceled') {
      this.webhookEvents.record(payload.event_id, payload.subscription_id, payload.type, 'ignored');
      return { statusCode: 200, body: { received: true, applied: false } };
    }

    const invoice: Invoice = existingInvoice ?? {
      id: payload.invoice_id,
      subscriptionId: payload.subscription_id,
      amount: payload.amount,
      currency: payload.currency,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    const applied = this.applyWebhook(subscription, invoice, payload);
    this.invoices.save(invoice);
    this.subscriptions.save(subscription);
    this.webhookEvents.record(payload.event_id, payload.subscription_id, payload.type, applied ? 'applied' : 'ignored');
    return { statusCode: 200, body: { received: true, applied } };
  }

  private applyWebhook(subscription: Subscription, invoice: Invoice, payload: WebhookPayload): boolean {
    if (payload.type === 'payment.succeeded') {
      if (invoice.status === 'succeeded' || invoice.status === 'refunded') {
        return false;
      }
      invoice.status = 'succeeded';
      try {
        subscription.paymentSucceeded();
      } catch (error) {
        if (error instanceof InvalidTransitionError) {
          return false;
        }
        throw error;
      }
      return true;
    }
    if (payload.type === 'payment.failed') {
      if (invoice.status === 'succeeded' || invoice.status === 'refunded') {
        return false;
      }
      invoice.status = 'failed';
      subscription.paymentFailed(payload.retries_exhausted ?? false);
      return true;
    }
    if (invoice.status !== 'succeeded') {
      return false;
    }
    invoice.status = 'refunded';
    return true;
  }

  private persistCharge(
    subscription: Subscription,
    invoiceId: string,
    amount: number,
    currency: string,
    outcome: ChargeOutcome,
  ): void {
    let status: InvoiceStatus;
    if (outcome.kind === 'succeeded') {
      status = 'succeeded';
      subscription.paymentSucceeded();
    } else if (outcome.kind === 'declined') {
      status = 'failed';
      subscription.paymentFailed();
    } else {
      status = 'pending';
      subscription.paymentFailed();
    }
    this.invoices.save({
      id: invoiceId,
      subscriptionId: subscription.id,
      amount,
      currency,
      status,
      providerReference: outcome.kind === 'succeeded' ? outcome.providerReference : undefined,
      createdAt: new Date().toISOString(),
    });
    this.subscriptions.save(subscription);
  }

  private isValidSignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) {
      return false;
    }
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest();
    const actual = Buffer.from(signature, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private isCreateRequest(body: unknown): body is CreateSubscriptionRequest {
    if (!body || typeof body !== 'object') {
      return false;
    }
    const request = body as Partial<CreateSubscriptionRequest>;
    return typeof request.customer_id === 'string' && request.customer_id.length > 0
      && typeof request.plan === 'string' && request.plan.length > 0
      && typeof request.payment_method_id === 'string' && request.payment_method_id.length > 0;
  }

  private isWebhookPayload(payload: unknown): payload is WebhookPayload {
    if (!payload || typeof payload !== 'object') {
      return false;
    }
    const event = payload as Partial<WebhookPayload>;
    const types: PaymentWebhookType[] = ['payment.succeeded', 'payment.failed', 'payment.refunded'];
    return typeof event.event_id === 'string' && event.event_id.length > 0
      && types.includes(event.type as PaymentWebhookType)
      && typeof event.subscription_id === 'string' && event.subscription_id.length > 0
      && typeof event.invoice_id === 'string' && event.invoice_id.length > 0
      && typeof event.amount === 'number' && Number.isFinite(event.amount) && event.amount > 0
      && typeof event.currency === 'string' && /^[A-Z]{3}$/.test(event.currency)
      && (event.retries_exhausted === undefined || typeof event.retries_exhausted === 'boolean');
  }

  private presentSubscription(subscription: Subscription): object {
    const snapshot = subscription.snapshot();
    return {
      id: snapshot.id,
      customer_id: snapshot.customerId,
      plan: snapshot.plan,
      status: snapshot.status,
      trial_ends_at: snapshot.trialEndsAt,
      created_at: snapshot.createdAt,
    };
  }
}
