import { z } from 'zod';
import { Clock } from '../domain/time';
import { CURRENCY, Invoice, Subscription, WEBHOOK_EVENT_TYPES, WebhookOutcome } from '../domain/types';
import { Repositories } from '../persistence/repositories';
import { isUniqueViolation, SqlDatabase } from '../persistence/SqlDatabase';
import { DomainError } from './errors';
import { ApplyResult, PaymentOutcomes } from './PaymentOutcomes';
import { WebhookSignature } from './WebhookSignature';

export const webhookPayloadSchema = z.object({
  event_id: z.string().min(1),
  type: z.enum(WEBHOOK_EVENT_TYPES),
  subscription_id: z.string().min(1),
  invoice_id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  charge_id: z.string().min(1).optional(),
  failure_reason: z.string().optional(),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

export interface WebhookReceipt {
  event_id: string;
  outcome: WebhookOutcome | 'duplicate';
  reason?: string;
}

/**
 * Inbound provider events. Request-level checks (signature, shape) come first and touch nothing.
 * Then the event is applied and recorded in the same transaction, keyed by event_id, so a
 * redelivered event is recognised and never re-applied.
 */
export class WebhookService {
  constructor(
    private readonly db: SqlDatabase,
    private readonly repos: Repositories,
    private readonly outcomes: PaymentOutcomes,
    private readonly signature: WebhookSignature,
    private readonly clock: Clock,
  ) {}

  receive(rawBody: Buffer, signatureHeader: string | undefined): WebhookReceipt {
    if (!signatureHeader) throw new DomainError('missing_signature', 'X-Provider-Signature header is required');
    if (!this.signature.verify(rawBody, signatureHeader)) {
      throw new DomainError('invalid_signature', 'Signature does not match payload');
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new DomainError('malformed_payload', 'Body is not valid JSON');
    }
    const parsed = webhookPayloadSchema.safeParse(json);
    if (!parsed.success) {
      throw new DomainError('malformed_payload', 'Payload failed validation', {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const event = parsed.data;

    const seen = this.repos.webhookEvents.findById(event.event_id);
    if (seen) return { event_id: event.event_id, outcome: 'duplicate' };

    try {
      return this.db.transaction(() => {
        const result = this.handle(event);
        const outcome: WebhookOutcome = result.applied ? 'processed' : 'ignored';
        this.repos.webhookEvents.insert({
          eventId: event.event_id,
          type: event.type,
          subscriptionId: event.subscription_id,
          invoiceId: event.invoice_id,
          payload: rawBody.toString('utf8'),
          outcome,
          reason: result.applied ? null : result.reason,
          receivedAt: this.clock.now(),
        });
        return result.applied
          ? { event_id: event.event_id, outcome }
          : { event_id: event.event_id, outcome, reason: result.reason };
      });
    } catch (error) {
      // Lost a race with a concurrent delivery of the same event: the other one won and was recorded.
      if (isUniqueViolation(error) && this.repos.webhookEvents.findById(event.event_id)) {
        return { event_id: event.event_id, outcome: 'duplicate' };
      }
      throw error;
    }
  }

  private handle(event: WebhookPayload): ApplyResult {
    const sub = this.repos.subscriptions.findById(event.subscription_id);
    if (!sub) return { applied: false, reason: 'unknown_subscription' };
    const invoice = this.repos.invoices.findById(event.invoice_id);
    if (!invoice) return { applied: false, reason: 'unknown_invoice' };
    if (invoice.subscriptionId !== sub.id) return { applied: false, reason: 'invoice_subscription_mismatch' };
    if (event.amount !== invoice.amountCents || event.currency !== CURRENCY) {
      return { applied: false, reason: 'amount_mismatch' };
    }

    if (event.type === 'payment.refunded') return this.refund(sub, invoice, event);

    return this.outcomes.apply({
      subscription: sub,
      invoice,
      result: event.type === 'payment.succeeded' ? 'succeeded' : 'declined',
      providerChargeId: event.charge_id ?? null,
      failureReason: event.failure_reason ?? null,
      source: 'webhook',
      reference: event.event_id,
      at: this.clock.now(),
    });
  }

  /** Refunds close out a paid invoice. They don't move the subscription (the spec defines no such transition). */
  private refund(sub: Subscription, invoice: Invoice, event: WebhookPayload): ApplyResult {
    if (invoice.status !== 'paid') return { applied: false, reason: `invoice_${invoice.status}` };
    const now = this.clock.now();
    this.repos.invoices.transition(invoice.id, 'refunded', now);
    this.repos.audit.append({
      subscriptionId: sub.id,
      action: 'invoice_refunded',
      source: 'webhook',
      reference: event.event_id,
      at: now,
    });
    this.repos.notifications.record(sub.id, 'refund_issued', invoice.id, now);
    return { applied: true };
  }
}
