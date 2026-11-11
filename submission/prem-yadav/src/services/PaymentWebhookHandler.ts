
import { InvoicePaymentRepository } from '../repositories/InvoicePaymentRepository';
import { SubscriptionService } from './SubscriptionService';
import { WebhookEventRepository } from '../repositories/WebhookEventRepository';

export interface PaymentWebhookEvent {
    event_id: string;
    type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
    subscription_id: string;
    invoice_id: string;
    amount: number;
    currency: string;
}

export class PaymentWebhookHandler {
    constructor(
        private readonly subscriptionService: SubscriptionService,
        private readonly webhookRepository: WebhookEventRepository,
        private readonly invoicePaymentRepository: InvoicePaymentRepository
    ) {}

    handle(event: PaymentWebhookEvent): { processed: boolean } {
        return this.webhookRepository.runInTransaction(() => {
            const supportedEventTypes = [
                'payment.succeeded',
                'payment.failed',
                'payment.refunded'
            ];

            if (
                !event ||
                !event.event_id ||
                !supportedEventTypes.includes(event.type) ||
                !event.subscription_id ||
                !event.invoice_id ||
                !Number.isFinite(event.amount) ||
                event.amount <= 0 ||
                !event.currency
            ) {
                throw new Error('Invalid webhook event payload');
            }

            const isNewEvent = this.webhookRepository.recordIfNew(
                event.event_id,
                event.type
            );

            if (!isNewEvent) {
                return { processed: false };
            }

            const subscription = this.subscriptionService.getSubscription(
                event.subscription_id
            );
            if (
                event.amount !== subscription.amount ||
                event.currency.toUpperCase() !== subscription.currency.toUpperCase()
            ) {
                throw new Error('Webhook payment amount or currency mismatch');
            }

            if (subscription.status === 'canceled') {
                return { processed: true };
            }

            if (event.type === 'payment.succeeded') {
                const accepted = this.invoicePaymentRepository.recordOutcome(
                    event.invoice_id,
                    event.subscription_id,
                    'succeeded'
                );

                if (
                    accepted &&
                    (subscription.status === 'trialing' ||
                        subscription.status === 'past_due')
                ) {
                    this.subscriptionService.updateSubscriptionStatus(
                        subscription.id,
                        'active'
                    );
                }
            } else if (event.type === 'payment.failed') {
                const accepted = this.invoicePaymentRepository.recordOutcome(
                    event.invoice_id,
                    event.subscription_id,
                    'failed'
                );

                if (
                    accepted &&
                    (subscription.status === 'trialing' ||
                        subscription.status === 'active')
                ) {
                    this.subscriptionService.updateSubscriptionStatus(
                        subscription.id,
                        'past_due'
                    );
                }
            } else if (event.type === 'payment.refunded') {
                this.invoicePaymentRepository.recordOutcome(
                    event.invoice_id,
                    event.subscription_id,
                    'refunded'
                );
            }

            return { processed: true };
        });
    }
}
