import { iso, type Clock } from '../domain/clock';
import { DomainError } from '../domain/errors';
import type { SubscriptionStateMachine } from '../domain/subscription-state-machine';
import { triggerForChargeOutcome } from '../domain/subscription-state-machine';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '../domain/types';
import type { InvoiceRecord, WebhookEventRecord } from '../persistence/records';
import type { SubscriptionState as State } from '../domain/types';
import type { Repositories } from '../persistence/repositories';
import type { BillingEngine } from './billing-engine';

export interface InboundWebhookEvent {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export type WebhookProcessingStatus = 'processed' | 'duplicate' | 'ignored';

export interface WebhookProcessingResult {
  status: WebhookProcessingStatus;
  event_id: string;
  subscription_id: string;
  subscription_state: State;
  reason?: string;
}

export interface WebhookProcessorDeps {
  repos: Repositories;
  engine: BillingEngine;
  clock: Clock;
  stateMachine: SubscriptionStateMachine;
}

/**
 * Inbound provider events.
 *
 * Three independent guards protect the lifecycle, in this order:
 *   1. event_id replay      -> `duplicate`, zero side effects
 *   2. terminal / invoice state -> `ignored` with an auditable reason
 *   3. the state machine    -> `ignored`, because the edge does not exist
 *
 * Processing is fully synchronous: on Node's single-threaded event loop the
 * check-then-insert of the event id cannot interleave, which is what makes
 * concurrent redelivery safe here (see docs/TEST_STRATEGY.md for the caveat).
 */
export class WebhookProcessor {
  constructor(private readonly deps: WebhookProcessorDeps) {}

  static parse(raw: unknown): InboundWebhookEvent {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new DomainError('INVALID_PAYLOAD', 'Webhook body must be a JSON object', 400);
    }
    const body = raw as Record<string, unknown>;
    const stringField = (name: string): string => {
      const value = body[name];
      if (typeof value !== 'string' || value.trim() === '') {
        throw new DomainError('INVALID_PAYLOAD', `Invalid or missing field: ${name}`, 400, {
          field: name
        });
      }
      return value;
    };
    const type = stringField('type');
    if (!WEBHOOK_EVENT_TYPES.includes(type as WebhookEventType)) {
      throw new DomainError('INVALID_PAYLOAD', `Unsupported event type: ${type}`, 400, { type });
    }
    const amount = body.amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
      throw new DomainError('INVALID_PAYLOAD', 'Field `amount` must be a non-negative integer', 400, {
        field: 'amount'
      });
    }
    return {
      event_id: stringField('event_id'),
      type: type as WebhookEventType,
      subscription_id: stringField('subscription_id'),
      invoice_id: stringField('invoice_id'),
      amount,
      currency: stringField('currency')
    };
  }

  process(event: InboundWebhookEvent): WebhookProcessingResult {
    const { repos, engine, stateMachine } = this.deps;

    // (1) Replay guard. Must come before anything observable happens.
    const existing = repos.webhookEvents.findById(event.event_id);
    if (existing) {
      repos.webhookEvents.recordRedelivery(event.event_id, iso(this.deps.clock.now()));
      return {
        status: 'duplicate',
        event_id: event.event_id,
        subscription_id: existing.subscription_id,
        subscription_state: repos.subscriptions.requireById(existing.subscription_id).state,
        reason: 'EVENT_ALREADY_PROCESSED'
      };
    }

    // Unknown references are rejected without being recorded, so the provider's
    // retry of a genuinely mis-routed event is not swallowed as a duplicate.
    const sub = repos.subscriptions.requireById(event.subscription_id);
    const invoice = repos.invoices.requireById(event.invoice_id);
    if (invoice.subscription_id !== sub.id) {
      throw DomainError.invoiceNotFound(event.invoice_id);
    }

    const stateBefore = sub.state;

    // (2) Business guards.
    const rejection = this.rejectionReason(event, invoice, stateBefore);
    if (rejection) {
      return this.record(event, stateBefore, stateBefore, 'ignored', rejection);
    }

    if (event.type === 'payment.refunded') {
      engine.settleInvoice(invoice.id, { status: 'refunded' });
      engine.recordNote(sub, 'invoice_refunded', { source: 'webhook', invoiceId: invoice.id, eventId: event.event_id });
      engine.notify('payment_refunded', sub, invoice.id);
      // Documented assumption: a refund is an invoice-level fact and does not
      // move the subscription; no such edge exists in the lifecycle diagram.
      return this.record(event, stateBefore, stateBefore, 'processed', null);
    }

    const succeeded = event.type === 'payment.succeeded';
    const trigger = triggerForChargeOutcome(stateBefore, succeeded ? 'succeeded' : 'failed');

    // (3) The state machine has the final word.
    const probe = stateMachine.transition(stateBefore, trigger, {
      retriesRemaining: sub.retries_remaining
    });
    if (!probe.ok) {
      return this.record(event, stateBefore, stateBefore, 'ignored', probe.reason);
    }

    engine.settleInvoice(
      invoice.id,
      succeeded
        ? { status: 'paid', provider_charge_id: `ch_${event.event_id}` }
        : { status: 'failed', failure_code: 'card_declined' }
    );
    engine.applyTrigger(sub.id, trigger, {
      source: 'webhook',
      invoiceId: invoice.id,
      eventId: event.event_id
    });

    const stateAfter = repos.subscriptions.requireById(sub.id).state;
    return this.record(event, stateBefore, stateAfter, 'processed', null);
  }

  /** Invoice-level guards: these catch out-of-order delivery the state machine cannot see. */
  private rejectionReason(
    event: InboundWebhookEvent,
    invoice: InvoiceRecord,
    state: State
  ): string | null {
    if (this.deps.stateMachine.isTerminal(state)) return 'SUBSCRIPTION_CANCELED';
    if (invoice.status === 'void') return 'INVOICE_VOID';
    if (event.amount !== invoice.amount_cents) return 'AMOUNT_MISMATCH';
    if (event.currency !== invoice.currency) return 'CURRENCY_MISMATCH';

    if (event.type === 'payment.succeeded') {
      if (invoice.status === 'paid') return 'INVOICE_ALREADY_PAID';
      if (invoice.status === 'failed') return 'STALE_EVENT_INVOICE_ALREADY_FAILED';
      if (invoice.status === 'refunded') return 'INVOICE_ALREADY_REFUNDED';
    }
    if (event.type === 'payment.failed') {
      // Out-of-order delivery: a failure for an invoice already settled as paid
      // must never regress an active subscription.
      if (invoice.status === 'paid') return 'STALE_EVENT_INVOICE_ALREADY_PAID';
      if (invoice.status === 'failed') return 'INVOICE_ALREADY_FAILED';
      if (invoice.status === 'refunded') return 'INVOICE_ALREADY_REFUNDED';
    }
    if (event.type === 'payment.refunded' && invoice.status !== 'paid') {
      return 'INVOICE_NOT_PAID';
    }
    return null;
  }

  private record(
    event: InboundWebhookEvent,
    before: State,
    after: State,
    outcome: 'processed' | 'ignored',
    reason: string | null
  ): WebhookProcessingResult {
    const record: WebhookEventRecord = {
      event_id: event.event_id,
      type: event.type,
      subscription_id: event.subscription_id,
      invoice_id: event.invoice_id,
      amount_cents: event.amount,
      outcome,
      reason,
      state_before: before,
      state_after: after,
      received_at: iso(this.deps.clock.now()),
      delivery_count: 1,
      last_delivered_at: iso(this.deps.clock.now())
    };
    this.deps.repos.webhookEvents.insert(record);
    return {
      status: outcome,
      event_id: event.event_id,
      subscription_id: event.subscription_id,
      subscription_state: after,
      ...(reason ? { reason } : {})
    };
  }
}
