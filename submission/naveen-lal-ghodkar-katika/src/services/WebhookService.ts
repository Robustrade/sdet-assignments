import { BillingError } from '../errors';
import { auditEntryFor } from '../domain/AuditEntry';
import type { InvoiceRecord } from '../domain/Invoice';
import { settleFailure, settleSuccess } from '../domain/chargeSettlement';
import { Subscription, type TransitionResult } from '../domain/SubscriptionStateMachine';
import type { PaymentWebhookEvent, WebhookEventRecord } from '../domain/WebhookEvent';
import type { AuditLogRepository } from '../persistence/AuditLogRepository';
import type { InvoiceRepository } from '../persistence/InvoiceRepository';
import type { SubscriptionRepository } from '../persistence/SubscriptionRepository';
import type { WebhookEventRepository } from '../persistence/WebhookEventRepository';
import type { Clock } from '../support/Clock';
import type { KeyedMutex } from '../support/KeyedMutex';

/** How a delivery was handled; this is what the HTTP layer answers with. */
export type WebhookAck = 'processed' | 'duplicate' | 'ignored';

type IgnoreReason =
  | 'subscription_canceled'
  | 'invoice_not_found'
  | 'amount_mismatch'
  | 'invoice_not_paid'
  | 'invoice_already_paid'
  | 'invoice_already_failed'
  | 'invoice_already_refunded';

/** What handling an event decided to change. `process` is the only place that writes it. */
interface Handled {
  /** Set when the event changes nothing; the reason is stored on the event row. */
  readonly ignored?: IgnoreReason;
  /** The invoice with its new status. */
  readonly invoice?: InvoiceRecord;
  /** The subscription transition, already applied to the in-memory aggregate. */
  readonly transition?: TransitionResult;
}

/** Either the invoice to work on, or the outcome that ends handling right away. */
type InvoiceLookup = { invoice: InvoiceRecord } | { done: Handled };

const ignore = (reason: IgnoreReason): Handled => ({ ignored: reason });

/**
 * Applies provider webhooks to subscriptions and invoices.
 *
 * Rules that make redelivery and reordering safe:
 * 1. An `event_id` is handled once. A redelivery only increments `deliveryCount`.
 * 2. Only a `pending` invoice can be resolved by `payment.succeeded` / `payment.failed`, and only a
 *    `paid` one can be refunded. An invoice that already has a result is never overwritten.
 * 3. A `canceled` subscription is never moved by a webhook (refunds only touch the invoice).
 * 4. Subscription status changes only through `Subscription.apply`.
 * 5. Work for one subscription is serialized (shared mutex), so duplicates and cancels cannot interleave.
 *
 * The writes are not one transaction (in-memory repositories): the event row is written last, so a
 * crash in between would leave the event unrecorded and a redelivery would be handled again.
 */
export class WebhookService {
  constructor(
    private readonly subscriptions: SubscriptionRepository,
    private readonly invoices: InvoiceRepository,
    private readonly events: WebhookEventRepository,
    private readonly auditLog: AuditLogRepository,
    private readonly clock: Clock,
    private readonly mutex: KeyedMutex,
  ) {}

  async process(event: PaymentWebhookEvent): Promise<WebhookAck> {
    return this.mutex.runExclusive(event.subscriptionId, async () => {
      const now = this.clock.now();

      const known = await this.events.findByEventId(event.eventId);
      if (known) {
        await this.events.save({ ...known, deliveryCount: known.deliveryCount + 1, lastDeliveredAt: now.toISOString() });
        return 'duplicate';
      }

      const stored = await this.subscriptions.findById(event.subscriptionId);
      if (!stored) {
        throw new BillingError('subscription_not_found', `Subscription "${event.subscriptionId}" not found`);
      }
      const subscription = Subscription.rehydrate(stored);

      const handled = await this.handle(event, subscription);

      if (handled.invoice) {
        await this.invoices.save({ ...handled.invoice, updatedAt: now.toISOString() });
      }
      if (handled.transition) {
        await this.subscriptions.save(subscription.toRecord());
        await this.auditLog.append(auditEntryFor(event.subscriptionId, handled.transition, 'webhook', now, event.eventId));
      }
      await this.events.save(this.eventRecord(event, handled, now));
      return handled.ignored ? 'ignored' : 'processed';
    });
  }

  private async handle(event: PaymentWebhookEvent, subscription: Subscription): Promise<Handled> {
    if (event.type === 'payment.refunded') {
      return this.handleRefunded(event);
    }
    if (subscription.status === 'canceled') {
      return ignore('subscription_canceled');
    }
    return event.type === 'payment.succeeded'
      ? this.handleSucceeded(event, subscription)
      : this.handleFailed(event, subscription);
  }

  private async handleSucceeded(event: PaymentWebhookEvent, subscription: Subscription): Promise<Handled> {
    const found = await this.findPendingInvoice(event);
    if ('done' in found) {
      return found.done;
    }
    return { invoice: { ...found.invoice, status: 'paid' }, transition: settleSuccess(subscription) };
  }

  private async handleFailed(event: PaymentWebhookEvent, subscription: Subscription): Promise<Handled> {
    const found = await this.findPendingInvoice(event);
    if ('done' in found) {
      return found.done;
    }
    const invoice: InvoiceRecord = { ...found.invoice, status: 'failed' };
    const history = (await this.invoices.listBySubscription(event.subscriptionId)).map((row) =>
      row.id === invoice.id ? invoice : row,
    );
    return { invoice, transition: settleFailure(subscription, history) };
  }

  private async handleRefunded(event: PaymentWebhookEvent): Promise<Handled> {
    const found = await this.findInvoice(event);
    if ('done' in found) {
      return found.done;
    }
    if (found.invoice.status === 'refunded') {
      return ignore('invoice_already_refunded');
    }
    if (found.invoice.status !== 'paid') {
      return ignore('invoice_not_paid');
    }
    // No subscription transition: the lifecycle has no refund arrow.
    return { invoice: { ...found.invoice, status: 'refunded' } };
  }

  /** The invoice must exist, belong to the event's subscription and match the event's money. */
  private async findInvoice(event: PaymentWebhookEvent): Promise<InvoiceLookup> {
    const invoice = await this.invoices.findById(event.invoiceId);
    if (!invoice || invoice.subscriptionId !== event.subscriptionId) {
      return { done: ignore('invoice_not_found') };
    }
    if (invoice.amount !== event.amount || invoice.currency !== event.currency) {
      return { done: ignore('amount_mismatch') };
    }
    return { invoice };
  }

  /** Like `findInvoice`, and the invoice must still be waiting for its result. */
  private async findPendingInvoice(event: PaymentWebhookEvent): Promise<InvoiceLookup> {
    const found = await this.findInvoice(event);
    if ('done' in found) {
      return found;
    }
    switch (found.invoice.status) {
      case 'pending':
        return found;
      case 'paid':
        return { done: ignore('invoice_already_paid') };
      case 'failed':
        return { done: ignore('invoice_already_failed') };
      case 'refunded':
        return { done: ignore('invoice_already_refunded') };
    }
  }

  private eventRecord(event: PaymentWebhookEvent, handled: Handled, at: Date): WebhookEventRecord {
    const now = at.toISOString();
    return {
      eventId: event.eventId,
      type: event.type,
      subscriptionId: event.subscriptionId,
      invoiceId: event.invoiceId,
      outcome: handled.ignored ? 'ignored' : 'processed',
      ...(handled.ignored ? { reason: handled.ignored } : {}),
      deliveryCount: 1,
      receivedAt: now,
      lastDeliveredAt: now,
    };
  }
}
