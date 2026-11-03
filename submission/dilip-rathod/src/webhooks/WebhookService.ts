import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PaymentOutcomeHandler } from '../billing/PaymentOutcomeHandler';
import type { OutcomeResult } from '../domain/types';
import { ignored } from '../domain/types';
import type { Database } from '../persistence/Database';
import type { WebhookEventRepository } from '../persistence/repositories/EventRepositories';
import type { InvoiceRepository } from '../persistence/repositories/InvoiceRepository';
import type { PaymentAttemptRepository } from '../persistence/repositories/PaymentAttemptRepository';
import type { Clock } from '../shared/infrastructure';
import { iso } from '../shared/infrastructure';

export const SIGNATURE_HEADER = 'x-provider-signature';

export type SignatureCheck = 'valid' | 'missing' | 'invalid';

/** HMAC-SHA256 (hex) over the exact raw request body. */
export class WebhookSignatureVerifier {
  constructor(private readonly secret: string) {}

  verify(rawBody: Buffer, signature: string | undefined): SignatureCheck {
    if (!signature) return 'missing';
    const expected = createHmac('sha256', this.secret).update(rawBody).digest();
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected) ? 'valid' : 'invalid';
  }
}

export const WebhookEventSchema = z.object({
  event_id: z.string().min(1),
  type: z.enum(['payment.succeeded', 'payment.failed', 'payment.refunded']),
  subscription_id: z.string().min(1),
  invoice_id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  charge_id: z.string().min(1).optional(),
  failure_code: z.string().min(1).optional(),
});
export type ProviderWebhookEvent = z.infer<typeof WebhookEventSchema>;

export interface WebhookAck {
  eventId: string;
  outcome: 'applied' | 'ignored' | 'duplicate';
  reason?: string;
}

/**
 * Idempotent webhook processing. Each delivery is one transaction: either the event is new and
 * its effects plus its `webhook_events` row commit together, or it is a duplicate and only the
 * delivery is recorded. Ordering is enforced by invoice/attempt state, not by arrival time.
 */
export class WebhookService {
  constructor(
    private readonly db: Database,
    private readonly events: WebhookEventRepository,
    private readonly invoices: InvoiceRepository,
    private readonly attempts: PaymentAttemptRepository,
    private readonly outcomes: PaymentOutcomeHandler,
    private readonly clock: Clock,
  ) {}

  handle(event: ProviderWebhookEvent, rawPayload: string): WebhookAck {
    return this.db.transaction(() => {
      const receivedAt = iso(this.clock.now());
      if (this.events.exists(event.event_id)) {
        this.events.recordDelivery(event.event_id, receivedAt, true);
        return { eventId: event.event_id, outcome: 'duplicate' };
      }

      const result = this.apply(event);
      this.events.insert({
        eventId: event.event_id,
        type: event.type,
        subscriptionId: event.subscription_id,
        invoiceId: event.invoice_id,
        payload: rawPayload,
        outcome: result.applied ? 'applied' : 'ignored',
        reason: result.applied ? null : result.reason,
        receivedAt,
      });
      this.events.recordDelivery(event.event_id, receivedAt, false);
      return result.applied
        ? { eventId: event.event_id, outcome: 'applied' }
        : { eventId: event.event_id, outcome: 'ignored', reason: result.reason };
    });
  }

  private apply(event: ProviderWebhookEvent): OutcomeResult {
    const invoice = this.invoices.find(event.invoice_id);
    if (!invoice) return ignored('unknown_invoice');
    if (invoice.subscriptionId !== event.subscription_id) return ignored('subscription_mismatch');
    if (invoice.amount !== event.amount || invoice.currency !== event.currency) return ignored('amount_mismatch');

    if (event.type === 'payment.refunded') return this.outcomes.recordRefund(invoice, event.event_id);

    if (invoice.status !== 'open') return ignored('invoice_not_open');
    const attempt = this.attempts.findUnresolved(invoice.id);
    if (!attempt) return ignored('no_pending_attempt');

    const ctx = { source: 'webhook' as const, providerChargeId: event.charge_id ?? null, reference: event.event_id };
    return event.type === 'payment.succeeded'
      ? this.outcomes.recordSuccess(invoice, attempt, ctx)
      : this.outcomes.recordFailure(invoice, attempt, event.failure_code ?? 'unspecified', ctx);
  }
}
