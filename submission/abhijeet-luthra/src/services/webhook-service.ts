import { Clock } from '../clock';
import { TransactionRunner } from '../db/database';
import { isUnresolved } from '../domain/payment-state-machine';
import { AppError } from '../domain/errors';
import { Invoice, Payment, WebhookProcessingStatus } from '../domain/types';
import { Repositories } from '../repositories';
import { isValidSignature } from '../webhooks/signature';
import { parseWebhookPayload, WebhookPayload } from '../webhooks/webhook-payload';
import { PaymentOutcome, PaymentOutcomeApplier } from './payment-outcome-applier';

export type WebhookResult = { status: WebhookProcessingStatus | 'duplicate'; reason?: string };

type Match = { kind: 'matched'; payment: Payment } | { kind: 'unmatched'; status: 'ignored' | 'quarantined'; reason: string };

/**
 * Handles `POST /webhooks/payment-provider` (design §10, API_CONTRACTS §6).
 *
 * 1. Verify the HMAC over the raw body (401) and the payload shape (400) - no DB access.
 * 2. In ONE transaction: duplicate check by event_id, reference checks (404/422),
 *    match the event to a payment attempt, apply the outcome, store the event.
 * Any exception rolls the whole transaction back, so a redelivery can process once.
 */
export class WebhookService {
  constructor(
    private readonly repos: Repositories,
    private readonly tx: TransactionRunner,
    private readonly clock: Clock,
    private readonly applier: PaymentOutcomeApplier,
    private readonly secret: string,
  ) {}

  handle(rawBody: Buffer, signature: string | undefined): WebhookResult {
    if (!isValidSignature(this.secret, rawBody, signature)) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Missing or invalid X-Provider-Signature');
    }
    const event = parseWebhookPayload(rawBody);

    return this.tx(() => {
      const now = this.clock.now().toISOString();

      // Same event_id again = duplicate delivery: record it, change nothing else.
      if (this.repos.webhookEvents.findById(event.eventId)) {
        this.repos.webhookEvents.recordDuplicateDelivery(event.eventId, now);
        return { status: 'duplicate' };
      }

      const invoice = this.validateReferences(event);
      const decision = this.decide(event, invoice);

      this.repos.webhookEvents.insert({
        eventId: event.eventId,
        eventType: event.type,
        subscriptionId: event.subscriptionId,
        invoiceId: event.invoiceId,
        providerReference: event.providerReference ?? null,
        payload: rawBody.toString('utf8'),
        processingStatus: decision.status,
        ignoreReason: decision.reason ?? null,
        matchedPaymentId: decision.matchedPaymentId ?? null,
        deliveryCount: 1,
        firstReceivedAt: now,
        lastReceivedAt: now,
      });
      return decision.reason ? { status: decision.status, reason: decision.reason } : { status: decision.status };
    });
  }

  private validateReferences(event: WebhookPayload): Invoice {
    const subscription = this.repos.subscriptions.findById(event.subscriptionId);
    if (!subscription) throw new AppError(404, 'SUBSCRIPTION_NOT_FOUND', `Subscription ${event.subscriptionId} does not exist`);
    const invoice = this.repos.invoices.findById(event.invoiceId);
    if (!invoice) throw new AppError(404, 'INVOICE_NOT_FOUND', `Invoice ${event.invoiceId} does not exist`);
    if (invoice.subscriptionId !== subscription.id) {
      throw new AppError(422, 'EVENT_REFERENCE_MISMATCH', 'Invoice does not belong to the subscription');
    }
    if (invoice.amountMinor !== event.amount || invoice.currency !== event.currency) {
      throw new AppError(422, 'EVENT_REFERENCE_MISMATCH', 'Amount or currency does not match the invoice');
    }
    if (event.providerReference) {
      const referenced = this.repos.payments.findByProviderReference(event.providerReference);
      if (referenced && referenced.invoiceId !== invoice.id) {
        throw new AppError(422, 'EVENT_REFERENCE_MISMATCH', 'provider_reference belongs to a different invoice');
      }
    }
    return invoice;
  }

  private decide(
    event: WebhookPayload,
    invoice: Invoice,
  ): { status: WebhookProcessingStatus; reason?: string; matchedPaymentId?: string } {
    const subscription = this.repos.subscriptions.findById(event.subscriptionId)!;
    if (subscription.status === 'canceled') return { status: 'ignored', reason: 'subscription_canceled' };

    const match = this.matchAttempt(event, invoice);
    if (match.kind === 'unmatched') return { status: match.status, reason: match.reason };

    const result = this.applier.apply(match.payment, toOutcome(event), { trigger: 'webhook', referenceId: event.eventId });
    return result.applied
      ? { status: 'processed', matchedPaymentId: match.payment.id }
      : { status: 'ignored', reason: result.reason, matchedPaymentId: match.payment.id };
  }

  /**
   * Event -> payment attempt matching (API_CONTRACTS §6.1). Never guesses:
   *  1. provider_reference stored on an attempt of this invoice -> that attempt;
   *  3. otherwise look at the invoice's unresolved attempts:
   *     exactly one -> match; zero -> ignored; two or more -> quarantined.
   * Refunds match the invoice's single succeeded attempt when no reference is stored.
   */
  private matchAttempt(event: WebhookPayload, invoice: Invoice): Match {
    if (event.providerReference) {
      const byReference = this.repos.payments.findByProviderReference(event.providerReference);
      if (byReference) return { kind: 'matched', payment: byReference }; // invoice ownership checked earlier
    }
    const attempts = this.repos.payments.findByInvoice(invoice.id);

    if (event.type === 'payment.refunded') {
      const succeeded = attempts.filter((a) => a.status === 'succeeded');
      return succeeded.length === 1
        ? { kind: 'matched', payment: succeeded[0] }
        : { kind: 'unmatched', status: 'ignored', reason: 'no_refundable_payment' };
    }

    const unresolved = attempts.filter((a) => isUnresolved(a.status));
    if (unresolved.length === 1) return { kind: 'matched', payment: unresolved[0] };
    if (unresolved.length > 1) return { kind: 'unmatched', status: 'quarantined', reason: 'ambiguous_payment_attempt' };
    return {
      kind: 'unmatched',
      status: 'ignored',
      reason: invoice.status === 'paid' || invoice.status === 'refunded' ? 'invoice_already_paid' : 'no_unresolved_attempt',
    };
  }
}

function toOutcome(event: WebhookPayload): PaymentOutcome {
  switch (event.type) {
    case 'payment.succeeded':
      return { type: 'succeeded', providerReference: event.providerReference };
    case 'payment.failed':
      return { type: 'failed', providerReference: event.providerReference };
    case 'payment.refunded':
      return { type: 'refunded' };
  }
}
