import { InvalidSignatureError, MalformedWebhookError } from '../domain/errors';
import type { WebhookEventType, WebhookOutcome } from '../domain/types';
import type { Repositories } from '../persistence/repositories';
import type { Clock } from '../ports/Clock';
import type { BillingEngine, SettleResult } from './BillingEngine';
import type { WebhookSignatureVerifier } from './WebhookSignatureVerifier';

export interface WebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
  failure_reason?: string;
}

export interface WebhookResponse {
  event_id: string;
  status: Exclude<WebhookOutcome, 'processing'> | 'duplicate';
  reason: string | null;
}

const TYPES: readonly WebhookEventType[] = ['payment.succeeded', 'payment.failed', 'payment.refunded'];

export function parseWebhookPayload(raw: Buffer): WebhookPayload {
  let body: unknown;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new MalformedWebhookError('Body is not valid JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new MalformedWebhookError('Body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  for (const f of ['event_id', 'subscription_id', 'invoice_id', 'currency'] as const) {
    if (typeof b[f] !== 'string' || (b[f] as string).length === 0) {
      throw new MalformedWebhookError(`'${f}' must be a non-empty string`);
    }
  }
  if (!TYPES.includes(b.type as WebhookEventType)) throw new MalformedWebhookError(`Unsupported type '${String(b.type)}'`);
  if (!Number.isInteger(b.amount) || (b.amount as number) <= 0) {
    throw new MalformedWebhookError("'amount' must be a positive integer (minor units)");
  }
  return b as unknown as WebhookPayload;
}

/**
 * Pipeline: verify signature -> parse -> idempotency check -> business checks -> apply.
 * The webhook_events table is the idempotency ledger (keyed by event_id).
 */
export class WebhookService {
  constructor(
    private readonly repos: Repositories,
    private readonly billing: BillingEngine,
    private readonly verifier: WebhookSignatureVerifier,
    private readonly clock: Clock,
  ) {}

  handle(rawBody: Buffer, signature: string | undefined): WebhookResponse {
    if (!this.verifier.isValid(rawBody, signature)) throw new InvalidSignatureError();
    const event = parseWebhookPayload(rawBody);
    const now = this.clock.now().toISOString();

    const seen = this.repos.webhookEvents.findById(event.event_id);
    if (seen) {
      this.repos.webhookEvents.update({ ...seen, deliveryCount: seen.deliveryCount + 1, lastReceivedAt: now });
      if (this.repos.subscriptions.findById(event.subscription_id)) {
        this.repos.audit.append({
          subscriptionId: event.subscription_id, action: 'webhook.duplicate_ignored', fromStatus: null, toStatus: null,
          detail: event.event_id, at: now,
        });
      }
      return { event_id: event.event_id, status: 'duplicate', reason: null };
    }

    // Claim the event id BEFORE applying effects.
    this.repos.webhookEvents.insert({
      eventId: event.event_id, type: event.type, subscriptionId: event.subscription_id, invoiceId: event.invoice_id,
      outcome: 'processing', reason: null, deliveryCount: 1, firstReceivedAt: now, lastReceivedAt: now,
    });

    let result: SettleResult;
    try {
      result = this.dispatch(event);
    } catch (err) {
      // Release the claim so the provider's redelivery can be processed.
      this.repos.webhookEvents.delete(event.event_id);
      throw err;
    }

    const outcome: 'processed' | 'ignored' = result.applied ? 'processed' : 'ignored';
    const reason = result.applied ? null : result.reason;
    this.repos.webhookEvents.update({ ...this.repos.webhookEvents.findById(event.event_id)!, outcome, reason });
    if (!result.applied && this.repos.subscriptions.findById(event.subscription_id)) {
      this.repos.audit.append({
        subscriptionId: event.subscription_id, action: 'webhook.ignored', fromStatus: null, toStatus: null,
        detail: `${event.event_id}:${reason}`, at: now,
      });
    }
    return { event_id: event.event_id, status: outcome, reason };
  }

  private dispatch(e: WebhookPayload): SettleResult {
    const sub = this.repos.subscriptions.findById(e.subscription_id);
    if (!sub) return { applied: false, reason: 'unknown_subscription' };
    const invoice = this.repos.invoices.findById(e.invoice_id);
    if (!invoice || invoice.subscriptionId !== sub.id) return { applied: false, reason: 'unknown_invoice' };
    if (invoice.amount !== e.amount || invoice.currency !== e.currency) return { applied: false, reason: 'amount_mismatch' };

    switch (e.type) {
      case 'payment.succeeded':
        if (sub.status === 'canceled') return { applied: false, reason: 'subscription_canceled' };
        return this.billing.settleSuccess(sub.id, invoice.id, 'webhook', `wh:${e.event_id}`);
      case 'payment.failed':
        if (sub.status === 'canceled') return { applied: false, reason: 'subscription_canceled' };
        return this.billing.settleFailure(sub.id, invoice.id, 'webhook', e.failure_reason ?? 'provider_reported_failure');
      case 'payment.refunded':
        return this.billing.settleRefund(sub.id, invoice.id);
    }
  }
}
