
import type BetterSqlite3 from 'better-sqlite3';

import { WebhookRepository } from '../repositories/WebhookRepository.js';
import { InvoiceRepository } from '../repositories/InvoiceRepository.js';
import { SubscriptionRepository } from '../repositories/SubscriptionRepository.js';
import { AuditLogRepository } from '../repositories/AuditLogRepository.js';

import { SubscriptionStateMachine } from '../domain/subscription/SubscriptionStateMachine.js';

import { WebhookSignature } from '../webhooks/WebhookSignature.js';

import type {
  PaymentWebhook
} from '../webhooks/WebhookTypes.js';

export type WebhookProcessingResult = {
  eventId: string;
  status: 'processed' | 'ignored' | 'duplicate' | 'invalid';
  message: string;
};

export class WebhookService {
  constructor(
    private readonly db: BetterSqlite3.Database,
    private readonly webhookRepository: WebhookRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly auditLogRepository: AuditLogRepository,
    private readonly stateMachine: SubscriptionStateMachine,
    private readonly webhookSecret: string
  ) {}

  async processWebhook(
    rawBody: string,
    signature: string
  ): Promise<WebhookProcessingResult> {
    // 1. Verify signature before trusting the payload.
    const validSignature = WebhookSignature.verify(
      rawBody,
      signature,
      this.webhookSecret
    );

    if (!validSignature) {
      return {
        eventId: '',
        status: 'invalid',
        message: 'Invalid webhook signature'
      };
    }

    // 2. Parse and validate the event.
    let event: PaymentWebhook;

    try {
      const parsed: unknown = JSON.parse(rawBody);
      event = this.validatePayload(parsed);
    } catch {
      return {
        eventId: '',
        status: 'invalid',
        message: 'Invalid webhook payload'
      };
    }

    // 3. Check duplicate event delivery.
    if (this.webhookRepository.exists(event.event_id)) {
      return {
        eventId: event.event_id,
        status: 'duplicate',
        message: 'Webhook event already received'
      };
    }

    // 4. Process and persist atomically.
    return this.db.transaction(() => {
      // Recheck inside the transaction.
      if (this.webhookRepository.exists(event.event_id)) {
        return {
          eventId: event.event_id,
          status: 'duplicate' as const,
          message: 'Webhook event already received'
        };
      }

      this.webhookRepository.create({
        event_id: event.event_id,
        event_type: event.event_type,
        subscription_id: event.data.subscription_id,
        payload_json: rawBody
      });

      const invoice = this.invoiceRepository.findById(
        event.data.invoice_id
      );

      if (!invoice) {
        this.webhookRepository.updateProcessingStatus(
          event.event_id,
          'failed'
        );

        return {
          eventId: event.event_id,
          status: 'invalid' as const,
          message: 'Invoice not found'
        };
      }

      if (invoice.subscription_id !== event.data.subscription_id) {
        this.webhookRepository.updateProcessingStatus(
          event.event_id,
          'failed'
        );

        return {
          eventId: event.event_id,
          status: 'invalid' as const,
          message: 'Invoice does not belong to subscription'
        };
      }

      // 5. Ignore events for invoices that already have a final result.
      if (invoice.status !== 'pending') {
        this.webhookRepository.updateProcessingStatus(
          event.event_id,
          'ignored'
        );

        return {
          eventId: event.event_id,
          status: 'ignored' as const,
          message: 'Invoice already has a final payment result'
        };
      }

      const subscription = this.subscriptionRepository.findById(
        event.data.subscription_id
      );

      if (!subscription) {
        this.webhookRepository.updateProcessingStatus(
          event.event_id,
          'failed'
        );

        return {
          eventId: event.event_id,
          status: 'invalid' as const,
          message: 'Subscription not found'
        };
      }

      if (subscription.status === 'canceled') {
        this.webhookRepository.updateProcessingStatus(
          event.event_id,
          'ignored'
        );

        return {
          eventId: event.event_id,
          status: 'ignored' as const,
          message: 'Subscription is already canceled'
        };
      }

      // 6. Prevent older payment events from reversing newer results.
      const latestProcessedEvent =
        this.webhookRepository.findLatestProcessedPaymentEvent(
          subscription.id
        );

      if (latestProcessedEvent) {
        const latestPayload: unknown = JSON.parse(
          latestProcessedEvent.payload_json
        );

        if (
          typeof latestPayload === 'object' &&
          latestPayload !== null &&
          'created_at' in latestPayload &&
          typeof latestPayload.created_at === 'string'
        ) {
          const latestTimestamp = Date.parse(
            latestPayload.created_at
          );

          const incomingTimestamp = Date.parse(event.created_at);

          if (
            !Number.isNaN(latestTimestamp) &&
            incomingTimestamp < latestTimestamp
          ) {
            this.webhookRepository.updateProcessingStatus(
              event.event_id,
              'ignored'
            );

            return {
              eventId: event.event_id,
              status: 'ignored' as const,
              message: 'Older payment event ignored because a newer event was already processed'
            };
          }
        }
      }

      // 7. Process successful payment.
      if (event.event_type === 'payment.succeeded') {
        this.invoiceRepository.updatePaymentResult(
          invoice.id,
          {
            status: 'succeeded',
            provider_reference: event.data.provider_reference
          }
        );

        if (subscription.status === 'trialing') {
          this.transitionSubscription(
            subscription.id,
            'PAYMENT_SUCCEEDED',
            'webhook'
          );
        } else if (subscription.status === 'past_due') {
          this.transitionSubscription(
            subscription.id,
            'RETRY_SUCCEEDED',
            'webhook'
          );
        }
      }

      // 8. Process failed payment.
      if (event.event_type === 'payment.failed') {
        this.invoiceRepository.updatePaymentResult(
          invoice.id,
          {
            status: 'failed',
            failure_reason: event.data.failure_reason
          }
        );

        if (
          subscription.status === 'trialing' ||
          subscription.status === 'active'
        ) {
          this.transitionSubscription(
            subscription.id,
            'PAYMENT_FAILED',
            'webhook'
          );
        }
      }

      // 9. Mark event as processed.
      this.webhookRepository.updateProcessingStatus(
        event.event_id,
        'processed'
      );

      return {
        eventId: event.event_id,
        status: 'processed' as const,
        message: 'Webhook processed successfully'
      };
    })();
  }

  private transitionSubscription(
    subscriptionId: string,
    event: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'RETRY_SUCCEEDED',
    source: string
  ): void {
    const subscription =
      this.subscriptionRepository.findById(subscriptionId);

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    const previousState = subscription.status;

    const nextState = this.stateMachine.transition(
      previousState,
      event
    );

    this.subscriptionRepository.updateStatus(
      subscriptionId,
      nextState
    );

    this.auditLogRepository.create({
      subscription_id: subscriptionId,
      event_type: event.toLowerCase(),
      previous_state: previousState,
      new_state: nextState,
      source
    });
  }

  private validatePayload(value: unknown): PaymentWebhook {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('event_id' in value) ||
      !('event_type' in value) ||
      !('created_at' in value) ||
      !('data' in value)
    ) {
      throw new Error('Invalid webhook structure');
    }

    const event = value as Record<string, unknown>;
    const data = event.data;

    if (
      typeof event.event_id !== 'string' ||
      event.event_id.trim() === '' ||
      typeof event.created_at !== 'string' ||
      Number.isNaN(Date.parse(event.created_at)) ||
      typeof data !== 'object' ||
      data === null ||
      !('invoice_id' in data) ||
      !('subscription_id' in data) ||
      typeof data.invoice_id !== 'string' ||
      data.invoice_id.trim() === '' ||
      typeof data.subscription_id !== 'string' ||
      data.subscription_id.trim() === ''
    ) {
      throw new Error('Invalid webhook fields');
    }

    if (
      event.event_type === 'payment.succeeded' &&
      'provider_reference' in data &&
      typeof data.provider_reference === 'string' &&
      data.provider_reference.trim() !== ''
    ) {
      return value as PaymentWebhook;
    }

    if (
      event.event_type === 'payment.failed' &&
      'failure_reason' in data &&
      typeof data.failure_reason === 'string' &&
      data.failure_reason.trim() !== ''
    ) {
      return value as PaymentWebhook;
    }

    throw new Error('Unsupported or invalid payment event');
  }
}
