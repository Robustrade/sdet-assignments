import type { CurrencyCode, Subscription } from '../../domain/models/subscription';
import type { Invoice, InvoiceStatus } from '../../domain/models/invoice';
import type { WebhookEvent, WebhookEventType } from '../../domain/models/webhook-event';
import { subscriptionStateMachine } from '../../domain/state/subscription-state';
import type { InvoiceRepository } from '../ports/invoice-repository';
import type { SubscriptionRepository } from '../ports/subscription-repository';
import type { WebhookEventRepository } from '../ports/webhook-event-repository';

export interface WebhookProcessingResult {
  processed: boolean;
  duplicate: boolean;
}

export class WebhookProcessingService {
  constructor(
    private readonly subscriptionRepository: SubscriptionRepository,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly webhookEventRepository: WebhookEventRepository,
  ) {}

  processWebhook(event: WebhookEvent, amount: number, currency: CurrencyCode): WebhookProcessingResult {
    const duplicate = this.webhookEventRepository.findByEventId(event.eventId);
    if (duplicate) {
      return { processed: false, duplicate: true };
    }

    const subscription = this.subscriptionRepository.findById(event.subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription not found: ${event.subscriptionId}`);
    }

    const invoice = this.invoiceRepository.findById(event.invoiceId);
    const nextInvoiceStatus = this.resolveInvoiceStatus(invoice?.status, event.type);
    const invoiceStatusChanged = invoice ? invoice.status !== nextInvoiceStatus : true;

    if (!invoice) {
      this.invoiceRepository.save({
        id: event.invoiceId,
        subscriptionId: event.subscriptionId,
        amount,
        currency,
        status: nextInvoiceStatus,
        createdAt: new Date().toISOString(),
      });
    } else if (invoiceStatusChanged) {
      invoice.status = nextInvoiceStatus;
      this.invoiceRepository.save(invoice);
    }

    this.applySubscriptionState(subscription, event.type, invoice?.status);
    this.subscriptionRepository.save(subscription);

    this.webhookEventRepository.save(event);

    return { processed: true, duplicate: false };
  }

  private resolveInvoiceStatus(currentStatus: InvoiceStatus | undefined, eventType: WebhookEventType): InvoiceStatus {
    if (currentStatus === 'refunded') {
      return 'refunded';
    }

    if (currentStatus === 'paid' && eventType === 'payment.failed') {
      return 'paid';
    }

    if (currentStatus === 'paid' && eventType === 'payment.refunded') {
      return 'refunded';
    }

    if (currentStatus === 'failed' && eventType === 'payment.succeeded') {
      return 'paid';
    }

    if (currentStatus === 'failed' && eventType === 'payment.failed') {
      return 'failed';
    }

    switch (eventType) {
      case 'payment.succeeded':
        return 'paid';
      case 'payment.failed':
        return 'failed';
      case 'payment.refunded':
        return 'refunded';
      default:
        return 'failed';
    }
  }

  private applySubscriptionState(subscription: Subscription, eventType: WebhookEventType, previousInvoiceStatus?: InvoiceStatus): void {
    if (eventType === 'payment.refunded') {
      return;
    }

    if (subscription.status === 'canceled') {
      return;
    }

    if (previousInvoiceStatus === 'paid' && eventType === 'payment.failed') {
      return;
    }

    if (previousInvoiceStatus === 'refunded') {
      return;
    }

    if (eventType === 'payment.succeeded') {
      if (subscription.status === 'active') {
        return;
      }

      if (subscriptionStateMachine.canTransition(subscription.status, 'active')) {
        subscription.status = 'active';
        subscription.updatedAt = new Date().toISOString();
      }
      return;
    }

    if (eventType === 'payment.failed') {
      if (subscription.status === 'past_due') {
        return;
      }

      if (subscriptionStateMachine.canTransition(subscription.status, 'past_due')) {
        subscription.status = 'past_due';
        subscription.updatedAt = new Date().toISOString();
      }
    }
  }
}
