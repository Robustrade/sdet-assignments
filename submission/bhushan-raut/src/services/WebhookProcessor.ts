import type { Clock } from '../clock';
import type { Notifier } from '../notifier';
import type { BillingRepository } from '../persistence/BillingRepository';
import { inTransaction, type Db } from '../persistence/database';
import type { SubscriptionRepository } from '../persistence/SubscriptionRepository';
import type { WebhookEventRepository, WebhookOutcome } from '../persistence/WebhookEventRepository';
import type { PaymentOutcomeApplier } from './PaymentOutcomeApplier';

const EVENT_TYPES = ['payment.succeeded', 'payment.failed', 'payment.refunded'] as const;
type EventType = (typeof EVENT_TYPES)[number];

export interface ProviderEvent {
  event_id: string;
  type: EventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export interface WebhookAck {
  event_id: string;
  outcome: WebhookOutcome;
  duplicate: boolean;
}

/** Returns the parsed event, or a reason it is malformed. */
export function parseEvent(rawBody: Buffer): ProviderEvent | string {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return 'body is not valid JSON';
  }
  if (typeof body !== 'object' || body === null) return 'body must be a JSON object';
  const e = body as Record<string, unknown>;
  for (const field of ['event_id', 'subscription_id', 'invoice_id', 'currency'] as const) {
    if (typeof e[field] !== 'string' || e[field] === '') return `${field} must be a non-empty string`;
  }
  if (!EVENT_TYPES.includes(e.type as EventType)) return `type must be one of ${EVENT_TYPES.join(', ')}`;
  if (!Number.isInteger(e.amount) || (e.amount as number) <= 0) return 'amount must be a positive integer';
  return e as unknown as ProviderEvent;
}

/**
 * Applies an authenticated provider event exactly once. The duplicate check, the state
 * change and the event record commit in one transaction, so a redelivery either sees
 * the event as already processed or the first delivery never happened.
 */
export class WebhookProcessor {
  constructor(
    private readonly db: Db,
    private readonly events: WebhookEventRepository,
    private readonly subscriptions: SubscriptionRepository,
    private readonly billing: BillingRepository,
    private readonly applier: PaymentOutcomeApplier,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  process(event: ProviderEvent, rawBody: Buffer): WebhookAck {
    const now = this.clock.now();
    let activated: string | undefined;

    const ack = inTransaction(this.db, (): WebhookAck => {
      const previous = this.events.findOutcome(event.event_id);
      if (previous) {
        this.events.recordRedelivery(event.event_id, now);
        return { event_id: event.event_id, outcome: previous, duplicate: true };
      }

      const outcome = this.decide(event, now, (id) => (activated = id));
      this.events.insert(
        {
          eventId: event.event_id,
          type: event.type,
          subscriptionId: event.subscription_id,
          invoiceId: event.invoice_id,
          payload: rawBody.toString('utf8'),
        },
        outcome,
        now,
      );
      return { event_id: event.event_id, outcome, duplicate: false };
    });

    // Side effects only after the transaction has committed.
    if (activated) this.notifier.subscriptionActivated(activated);
    return ack;
  }

  private decide(event: ProviderEvent, now: Date, onActivated: (id: string) => void): WebhookOutcome {
    const sub = this.subscriptions.find(event.subscription_id);
    const invoice = this.billing.findInvoice(event.invoice_id);
    if (!sub || !invoice || invoice.subscriptionId !== sub.id) return 'ignored_unknown_reference';
    if (invoice.amount !== event.amount || invoice.currency !== event.currency) return 'ignored_amount_mismatch';

    if (event.type === 'payment.refunded') {
      if (invoice.status !== 'paid') return 'ignored_stale';
      this.billing.setInvoiceStatus(invoice.id, 'refunded', now);
      return 'applied';
    }

    // A webhook settles a charge we are waiting on. With nothing pending, its outcome is already known.
    const attempt = this.billing.pendingAttemptForInvoice(invoice.id);
    if (!attempt) return 'ignored_stale';

    const providerRef = `evt:${event.event_id}`;
    const result = this.applier.apply(
      sub,
      invoice,
      attempt,
      event.type === 'payment.succeeded'
        ? { kind: 'succeeded', providerRef }
        : { kind: 'failed', providerRef, declineCode: 'provider_reported_failure' },
      { source: 'webhook', reference: event.event_id, at: now },
    );
    if (result.outcome === 'applied' && result.activated) onActivated(sub.id);
    return result.outcome;
  }
}
