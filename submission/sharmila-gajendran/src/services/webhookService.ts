import type { Clock } from '../domain/clock';
import type { StoredWebhookOutcome, WebhookOutcome } from '../domain/types';
import { inTransaction, type Db } from '../persistence/database';
import type { Repositories } from '../persistence/repositories';
import type { PaymentSettlement } from './paymentSettlement';
import type { ChangeContext } from './subscriptionLifecycle';

export const WEBHOOK_EVENT_TYPES = ['payment.succeeded', 'payment.failed', 'payment.refunded'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/** A webhook that already passed the signature check and payload validation. */
export interface PaymentWebhookEvent {
  readonly eventId: string;
  readonly type: WebhookEventType;
  readonly subscriptionId: string;
  readonly invoiceId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly failureReason: string | null;
}

/**
 * Idempotency, in two levels:
 *  1. Same event_id again -> 'duplicate', nothing changes (checked first, inside the transaction).
 *  2. New event_id for an invoice that is already settled -> 'ignored_stale' (PaymentSettlement).
 *
 * Everything for one event runs in one transaction. If any step fails, nothing is saved,
 * the event is not marked as processed, and the provider's redelivery is handled normally.
 */
export class WebhookService {
  constructor(
    private readonly db: Db,
    private readonly repos: Repositories,
    private readonly settlement: PaymentSettlement,
    private readonly clock: Clock,
  ) {}

  process(event: PaymentWebhookEvent): WebhookOutcome {
    return inTransaction(this.db, (): WebhookOutcome => {
      if (this.repos.webhookEvents.exists(event.eventId)) {
        return 'duplicate';
      }
      const outcome = this.settle(event);
      this.repos.webhookEvents.insert({
        eventId: event.eventId,
        type: event.type,
        subscriptionId: event.subscriptionId,
        invoiceId: event.invoiceId,
        outcome,
        receivedAt: this.clock.now().toISOString(),
      });
      return outcome;
    });
  }

  private settle(event: PaymentWebhookEvent): StoredWebhookOutcome {
    const invoice = this.repos.invoices.findById(event.invoiceId);
    if (!invoice || invoice.subscriptionId !== event.subscriptionId) {
      return 'ignored_unknown_reference';
    }
    const context: ChangeContext = { source: 'webhook', reference: event.eventId };
    switch (event.type) {
      case 'payment.succeeded':
        return this.settlement.settleSucceeded(invoice, null, context);
      case 'payment.failed':
        return this.settlement.settleFailed(invoice, null, event.failureReason ?? 'payment_failed', context);
      case 'payment.refunded':
        return this.settlement.settleRefunded(invoice, context);
    }
  }
}
