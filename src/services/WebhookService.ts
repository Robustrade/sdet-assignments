import type { PlanCatalog } from '../domain/PlanCatalog.js';
import { UnauthorizedError, ValidationError } from '../domain/errors.js';
import { transition } from '../domain/SubscriptionStateMachine.js';
import type {
  InboundWebhook,
  Invoice,
  Subscription,
  SubscriptionState,
  Trigger,
  WebhookEventType,
} from '../domain/types.js';
import type { InvoiceRepository } from '../persistence/InvoiceRepository.js';
import type { SubscriptionRepository } from '../persistence/SubscriptionRepository.js';
import type { WebhookEventRepository } from '../persistence/WebhookEventRepository.js';
import { verifyWebhook } from '../webhookSignature.js';
import { randomUUID } from 'node:crypto';

export type WebhookOutcome =
  | 'processed'
  | 'duplicate'
  | 'noop_illegal'
  | 'noop_stale_failed'
  | 'noop_refunded'
  | 'noop_unknown_type'
  | 'noop_unknown_subscription';

export interface WebhookProcessResult {
  outcome: WebhookOutcome;
  subscription: Subscription | undefined;
}

export class WebhookService {
  constructor(
    private readonly secret: string,
    private readonly subscriptions: SubscriptionRepository,
    private readonly invoices: InvoiceRepository,
    private readonly webhookEvents: WebhookEventRepository,
    private readonly plans: PlanCatalog,
  ) {}

  async process(rawBody: string, signature: string | undefined): Promise<WebhookProcessResult> {
    if (!verifyWebhook(rawBody, signature, this.secret)) {
      throw new UnauthorizedError('invalid or missing X-Provider-Signature');
    }

    let payload: InboundWebhook;
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') {
        throw new ValidationError('webhook payload must be an object');
      }
      payload = {
        eventId:
          typeof parsed.event_id === 'string' ? parsed.event_id : (parsed.eventId as string),
        type: typeof parsed.type === 'string' ? parsed.type : (parsed.type as WebhookEventType),
        subscriptionId:
          typeof parsed.subscription_id === 'string'
            ? parsed.subscription_id
            : (parsed.subscriptionId as string),
        invoiceId:
          typeof parsed.invoice_id === 'string'
            ? parsed.invoice_id
            : (parsed.invoiceId as string),
        amount: typeof parsed.amount === 'number' ? parsed.amount : (parsed.amount as number),
        currency:
          typeof parsed.currency === 'string' ? parsed.currency : (parsed.currency as string),
      };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('malformed JSON payload');
    }
    if (!payload.eventId || typeof payload.eventId !== 'string') {
      throw new ValidationError('event_id is required');
    }

    if (this.webhookEvents.hasProcessed(payload.eventId)) {
      return { outcome: 'duplicate', subscription: this.subscriptions.findById(payload.subscriptionId) };
    }

    const subscription = this.subscriptions.findById(payload.subscriptionId);
    if (!subscription) {
      this.recordEvent(payload.subscriptionId, payload, 'noop_unknown_subscription');
      return { outcome: 'noop_unknown_subscription', subscription: undefined };
    }

    const trigger = this.triggerFor(subscription.state, payload.type);
    const outcome = this.resolveOutcome(subscription, payload, trigger);

    return { outcome, subscription };
  }

  private resolveOutcome(
    subscription: Subscription,
    payload: InboundWebhook,
    trigger: Trigger | null,
  ): WebhookOutcome {
    if (payload.type === 'payment.refunded') {
      this.recordEvent(subscription.id, payload, 'noop_refunded');
      return 'noop_refunded';
    }

    if (payload.type !== 'payment.succeeded' && payload.type !== 'payment.failed') {
      this.recordEvent(subscription.id, payload, 'noop_unknown_type');
      return 'noop_unknown_type';
    }

    if (payload.type === 'payment.failed' && this.invoices.hasSucceededFor(payload.invoiceId)) {
      this.recordEvent(subscription.id, payload, 'noop_stale_failed');
      return 'noop_stale_failed';
    }

    if (trigger === null) {
      this.recordEvent(subscription.id, payload, 'noop_illegal');
      return 'noop_illegal';
    }

    const nextState = transition(subscription.state, trigger);
    if (nextState === null) {
      this.recordEvent(subscription.id, payload, 'noop_illegal');
      return 'noop_illegal';
    }

    const wasSucceeded = payload.type === 'payment.succeeded';
    const amount =
      typeof payload.amount === 'number' && payload.amount > 0
        ? payload.amount
        : (this.plans.findById(subscription.plan)?.price ?? 0);
    const currency =
      typeof payload.currency === 'string' && payload.currency.length > 0
        ? payload.currency
        : (this.plans.findById(subscription.plan)?.currency ?? 'USD');

    const invoice: Invoice = {
      id: `inv_${randomUUID()}`,
      subscriptionId: subscription.id,
      invoiceId: payload.invoiceId,
      status: wasSucceeded ? 'succeeded' : 'failed',
      amount,
      currency,
      providerRef: payload.eventId,
      eventId: payload.eventId,
      createdAt: new Date().toISOString(),
    };
    this.invoices.create(invoice);

    subscription.state = nextState;
    subscription.updatedAt = new Date().toISOString();
    this.subscriptions.upsert(subscription);

    this.recordEvent(subscription.id, payload, 'processed');
    return 'processed';
  }

  private recordEvent(
    subscriptionId: string,
    payload: InboundWebhook,
    outcome: string,
  ): void {
    this.webhookEvents.recordProcessed({
      eventId: payload.eventId,
      subscriptionId,
      type: payload.type,
      outcome,
      processedAt: new Date().toISOString(),
    });
  }

  private triggerFor(state: SubscriptionState, type: WebhookEventType): Trigger | null {
    switch (type) {
      case 'payment.succeeded':
        if (state === 'trialing') return 'trial_ends_charge_succeeded';
        if (state === 'past_due') return 'retry_charge_succeeded';
        return null;
      case 'payment.failed':
        if (state === 'trialing') return 'trial_ends_charge_failed';
        if (state === 'active') return 'recurring_charge_failed';
        return null;
      default:
        return null;
    }
  }
}