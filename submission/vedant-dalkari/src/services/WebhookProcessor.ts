/**
 * Inbound payment provider webhook processor with raw-body HMAC verification,
 * schema validation, idempotency, stale-event guards, and atomic SQL commits.
 * Author: Vedant Dalkari
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  UnprocessableEntityError,
  ValidationError,
} from '../domain/errors.js';
import type { LifecycleEngine } from '../domain/LifecycleEngine.js';
import type { PlanPolicyRegistry } from '../domain/PlanPolicy.js';
import type { WebhookEventType, WebhookOutcome } from '../domain/types.js';
import type { AuditLogRepo } from '../persistence/AuditLogRepo.js';
import type { InvoiceRepo } from '../persistence/InvoiceRepo.js';
import type { PaymentAttemptRepo } from '../persistence/PaymentAttemptRepo.js';
import type { SqliteDatabase } from '../persistence/SqliteDatabase.js';
import type { SubscriptionRepo } from '../persistence/SubscriptionRepo.js';
import type { WebhookEventRepo } from '../persistence/WebhookEventRepo.js';
import type { Clock } from '../ports/Clock.js';
import type { NotificationMessage, Notifier } from '../ports/Notifier.js';
import { nextPrefixedId, requireNonEmptyString } from './chargeHelpers.js';

export interface WebhookProcessorDeps {
  readonly db: SqliteDatabase;
  readonly subscriptionRepo: SubscriptionRepo;
  readonly invoiceRepo: InvoiceRepo;
  readonly paymentAttemptRepo: PaymentAttemptRepo;
  readonly webhookEventRepo: WebhookEventRepo;
  readonly auditLogRepo: AuditLogRepo;
  readonly lifecycleEngine: LifecycleEngine;
  readonly planRegistry: PlanPolicyRegistry;
  readonly clock: Clock;
  readonly notifier: Notifier;
  readonly webhookSecret: string;
}

export interface WebhookProcessResult {
  readonly status: 'processed' | 'duplicate_ignored' | 'ignored_stale_or_invalid';
  readonly event_id: string;
  readonly outcome?: WebhookOutcome;
}

interface ParsedWebhookPayload {
  readonly event_id: string;
  readonly type: WebhookEventType;
  readonly subscription_id: string;
  readonly invoice_id: string;
  readonly amount: number;
  readonly currency: string;
}

const VALID_EVENT_TYPES = new Set<WebhookEventType>([
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
]);

export class WebhookProcessor {
  public constructor(private readonly deps: WebhookProcessorDeps) {}

  public async processWebhook(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<WebhookProcessResult> {
    this.verifyHmacSignature(rawBody, signatureHeader);
    const payload = this.parseAndValidatePayload(rawBody);
    const payloadHash = this.computePayloadHash(payload);
    const nowIso = this.deps.clock.nowIso();

    let pendingNotification: NotificationMessage | null = null;

    const result = this.deps.db.inTransaction<WebhookProcessResult>(() => {
      const existingEvent = this.deps.webhookEventRepo.findByEventId(payload.event_id);
      if (existingEvent) {
        if (existingEvent.payload_hash !== payloadHash) {
          throw new ConflictError(
            `Webhook payload mismatch for already-recorded event_id "${payload.event_id}"`,
          );
        }
        return {
          status: 'duplicate_ignored',
          event_id: payload.event_id,
        };
      }

      const sub = this.deps.subscriptionRepo.findById(payload.subscription_id);
      if (!sub) {
        throw new NotFoundError(`Subscription "${payload.subscription_id}" not found`);
      }

      const policy = this.deps.planRegistry.resolve(sub.plan);
      if (
        payload.amount !== policy.config.amountCents ||
        payload.currency !== policy.config.currency
      ) {
        throw new UnprocessableEntityError(
          `Webhook amount/currency (${payload.amount} ${payload.currency}) mismatches plan "${sub.plan}" (${policy.config.amountCents} ${policy.config.currency})`,
        );
      }

      if (sub.status === 'canceled') {
        return this.recordIgnored(
          payload,
          payloadHash,
          nowIso,
          'ignored_invalid_transition',
        );
      }

      const invoice = this.deps.invoiceRepo.findById(payload.invoice_id);
      if (!invoice || invoice.subscription_id !== sub.id) {
        throw new NotFoundError(
          `Invoice "${payload.invoice_id}" not found for subscription "${sub.id}"`,
        );
      }

      if (payload.type === 'payment.succeeded') {
        if (invoice.status === 'paid' || invoice.status === 'refunded') {
          return this.recordIgnored(payload, payloadHash, nowIso, 'ignored_stale');
        }

        this.deps.invoiceRepo.updateStatus(invoice.id, 'paid', nowIso);
        this.deps.paymentAttemptRepo.create({
          id: nextPrefixedId('att'),
          invoice_id: invoice.id,
          subscription_id: sub.id,
          idempotency_key: `wh_${payload.event_id}`,
          amount_cents: payload.amount,
          currency: payload.currency,
          status: 'succeeded',
          provider_reference: `wh_ref_${payload.event_id}`,
          failure_reason: null,
          created_at: nowIso,
        });

        if (sub.status === 'trialing' || sub.status === 'past_due') {
          const transition = this.deps.lifecycleEngine.transition(
            sub.status,
            'payment_succeeded_webhook',
          );
          this.deps.subscriptionRepo.commitTransition(sub.id, transition, {
            failed_attempts: 0,
            current_period_start: invoice.period_start,
            current_period_end: invoice.period_end,
            updated_at: nowIso,
          });
          this.deps.auditLogRepo.append({
            id: nextPrefixedId('aud'),
            subscription_id: sub.id,
            from_status: sub.status,
            to_status: transition.toStatus,
            trigger: transition.trigger,
            actor: 'webhook',
            metadata_json: JSON.stringify({ event_id: payload.event_id, invoice_id: invoice.id }),
            created_at: nowIso,
          });
          pendingNotification = {
            eventType: 'subscription.activated',
            subscriptionId: sub.id,
            customerId: sub.customer_id,
            occurredAt: nowIso,
          };
        }

        this.deps.webhookEventRepo.record({
          event_id: payload.event_id,
          event_type: payload.type,
          subscription_id: sub.id,
          invoice_id: invoice.id,
          outcome: 'processed',
          payload_hash: payloadHash,
          received_at: nowIso,
        });

        return {
          status: 'processed',
          event_id: payload.event_id,
          outcome: 'processed',
        };
      }

      if (payload.type === 'payment.failed') {
        if (invoice.status === 'paid' || invoice.status === 'refunded') {
          return this.recordIgnored(payload, payloadHash, nowIso, 'ignored_stale');
        }

        this.deps.invoiceRepo.updateStatus(invoice.id, 'failed', nowIso);
        this.deps.paymentAttemptRepo.create({
          id: nextPrefixedId('att'),
          invoice_id: invoice.id,
          subscription_id: sub.id,
          idempotency_key: `wh_${payload.event_id}`,
          amount_cents: payload.amount,
          currency: payload.currency,
          status: 'declined',
          provider_reference: null,
          failure_reason: 'webhook_payment_failed',
          created_at: nowIso,
        });

        const nextFailed = sub.failed_attempts + 1;
        if (sub.status === 'trialing' || sub.status === 'active') {
          const transition = this.deps.lifecycleEngine.transition(
            sub.status,
            'payment_failed_webhook',
          );
          this.deps.subscriptionRepo.commitTransition(sub.id, transition, {
            failed_attempts: nextFailed,
            updated_at: nowIso,
          });
          this.deps.auditLogRepo.append({
            id: nextPrefixedId('aud'),
            subscription_id: sub.id,
            from_status: sub.status,
            to_status: transition.toStatus,
            trigger: transition.trigger,
            actor: 'webhook',
            metadata_json: JSON.stringify({ event_id: payload.event_id, invoice_id: invoice.id }),
            created_at: nowIso,
          });
          pendingNotification = {
            eventType: 'subscription.past_due',
            subscriptionId: sub.id,
            customerId: sub.customer_id,
            occurredAt: nowIso,
          };
        } else if (policy.isRetryExhausted(nextFailed)) {
          const transition = this.deps.lifecycleEngine.transition('past_due', 'retries_exhausted');
          this.deps.subscriptionRepo.commitTransition(sub.id, transition, {
            failed_attempts: nextFailed,
            canceled_at: nowIso,
            updated_at: nowIso,
          });
          this.deps.auditLogRepo.append({
            id: nextPrefixedId('aud'),
            subscription_id: sub.id,
            from_status: 'past_due',
            to_status: transition.toStatus,
            trigger: transition.trigger,
            actor: 'webhook',
            metadata_json: JSON.stringify({ event_id: payload.event_id, invoice_id: invoice.id }),
            created_at: nowIso,
          });
          pendingNotification = {
            eventType: 'subscription.canceled',
            subscriptionId: sub.id,
            customerId: sub.customer_id,
            occurredAt: nowIso,
          };
        } else {
          this.deps.subscriptionRepo.incrementFailedAttempts(sub.id, nextFailed, nowIso);
        }

        this.deps.webhookEventRepo.record({
          event_id: payload.event_id,
          event_type: payload.type,
          subscription_id: sub.id,
          invoice_id: invoice.id,
          outcome: 'processed',
          payload_hash: payloadHash,
          received_at: nowIso,
        });

        return {
          status: 'processed',
          event_id: payload.event_id,
          outcome: 'processed',
        };
      }

      // payload.type === 'payment.refunded'
      if (invoice.status !== 'paid' || (sub.status !== 'active' && sub.status !== 'past_due')) {
        return this.recordIgnored(
          payload,
          payloadHash,
          nowIso,
          'ignored_invalid_transition',
        );
      }

      const transition = this.deps.lifecycleEngine.transition(
        sub.status,
        'payment_refunded_webhook',
      );
      this.deps.invoiceRepo.updateStatus(invoice.id, 'refunded', nowIso);
      this.deps.subscriptionRepo.commitTransition(sub.id, transition, {
        canceled_at: nowIso,
        updated_at: nowIso,
      });
      this.deps.auditLogRepo.append({
        id: nextPrefixedId('aud'),
        subscription_id: sub.id,
        from_status: sub.status,
        to_status: transition.toStatus,
        trigger: transition.trigger,
        actor: 'webhook',
        metadata_json: JSON.stringify({ event_id: payload.event_id, invoice_id: invoice.id }),
        created_at: nowIso,
      });
      this.deps.webhookEventRepo.record({
        event_id: payload.event_id,
        event_type: payload.type,
        subscription_id: sub.id,
        invoice_id: invoice.id,
        outcome: 'processed',
        payload_hash: payloadHash,
        received_at: nowIso,
      });

      pendingNotification = {
        eventType: 'subscription.refunded',
        subscriptionId: sub.id,
        customerId: sub.customer_id,
        occurredAt: nowIso,
      };

      return {
        status: 'processed',
        event_id: payload.event_id,
        outcome: 'processed',
      };
    });

    if (pendingNotification) {
      await this.deps.notifier.notify(pendingNotification);
    }

    return result;
  }

  private recordIgnored(
    payload: ParsedWebhookPayload,
    payloadHash: string,
    nowIso: string,
    outcome: 'ignored_stale' | 'ignored_invalid_transition',
  ): WebhookProcessResult {
    this.deps.webhookEventRepo.record({
      event_id: payload.event_id,
      event_type: payload.type,
      subscription_id: payload.subscription_id,
      invoice_id: payload.invoice_id,
      outcome,
      payload_hash: payloadHash,
      received_at: nowIso,
    });
    return {
      status: 'ignored_stale_or_invalid',
      event_id: payload.event_id,
      outcome,
    };
  }

  private verifyHmacSignature(rawBody: Buffer, signatureHeader: string | undefined): void {
    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      throw new UnauthorizedError('Missing or malformed X-Provider-Signature header');
    }
    const providedHex = signatureHeader.slice('sha256='.length);
    if (!/^[0-9a-f]{64}$/i.test(providedHex)) {
      throw new UnauthorizedError('Invalid X-Provider-Signature digest format');
    }

    const expectedHex = createHmac('sha256', this.deps.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const providedBuf = Buffer.from(providedHex.toLowerCase(), 'utf8');
    const expectedBuf = Buffer.from(expectedHex.toLowerCase(), 'utf8');
    if (
      providedBuf.length !== expectedBuf.length ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw new UnauthorizedError('Invalid X-Provider-Signature HMAC digest');
    }
  }

  private parseAndValidatePayload(rawBody: Buffer): ParsedWebhookPayload {
    let decoded: unknown;
    try {
      decoded = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new ValidationError('Malformed JSON in webhook payload');
    }

    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw new ValidationError('Webhook payload must be a JSON object');
    }

    const obj = decoded as Record<string, unknown>;
    const eventId = requireNonEmptyString(obj.event_id, 'event_id');
    const eventType = requireNonEmptyString(obj.type, 'type');
    if (!VALID_EVENT_TYPES.has(eventType as WebhookEventType)) {
      throw new ValidationError(`Unsupported webhook event type "${eventType}"`);
    }
    const subscriptionId = requireNonEmptyString(obj.subscription_id, 'subscription_id');
    const invoiceId = requireNonEmptyString(obj.invoice_id, 'invoice_id');
    const currency = requireNonEmptyString(obj.currency, 'currency');

    if (
      typeof obj.amount !== 'number' ||
      !Number.isInteger(obj.amount) ||
      obj.amount <= 0
    ) {
      throw new ValidationError('Field "amount" must be a positive integer');
    }

    return {
      event_id: eventId,
      type: eventType as WebhookEventType,
      subscription_id: subscriptionId,
      invoice_id: invoiceId,
      amount: obj.amount,
      currency,
    };
  }

  private computePayloadHash(payload: ParsedWebhookPayload): string {
    const canonical = JSON.stringify({
      event_id: payload.event_id,
      type: payload.type,
      subscription_id: payload.subscription_id,
      invoice_id: payload.invoice_id,
      amount: payload.amount,
      currency: payload.currency,
    });
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }
}
