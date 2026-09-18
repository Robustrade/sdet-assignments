import type { DatabaseSync } from 'node:sqlite';

import {
    Trigger,
} from '../domain/SubscriptionState.js';

import {
    SubscriptionStateMachine,
} from '../domain/SubscriptionStateMachine.js';

import {
    AuditRepository,
} from '../infrastructure/repositories/AuditRepository.js';

import {
    InvoiceRepository,
} from '../infrastructure/repositories/InvoiceRepository.js';

import {
    SubscriptionRepository,
} from '../infrastructure/repositories/SubscriptionRepository.js';

import {
    WebhookRepository,
} from '../infrastructure/repositories/WebhookRepository.js';

import {
    runInTransaction,
} from '../infrastructure/sqlite/db.js';

export type WebhookEventType =
    | 'payment.succeeded'
    | 'payment.failed'
    | 'payment.refunded';

export interface WebhookPayload {
    eventId: string;
    eventType: WebhookEventType;
    subscriptionId: string;
    correlationId: string;
}

export interface WebhookProcessResult {
    duplicate: boolean;
    subscriptionId: string;
    status: string;
}

const PLAN_PRICES: Record<
    string,
    number
> = {
    basic: 1900,
    pro: 4900,
};

export class WebhookProcessor {
    private readonly webhookRepository: WebhookRepository;

    private readonly subscriptionRepository:
        SubscriptionRepository;

    private readonly invoiceRepository:
        InvoiceRepository;

    private readonly auditRepository:
        AuditRepository;

    private readonly stateMachine:
        SubscriptionStateMachine;

    constructor(
        private readonly db: DatabaseSync,
    ) {
        this.webhookRepository =
            new WebhookRepository(db);

        this.subscriptionRepository =
            new SubscriptionRepository(db);

        this.invoiceRepository =
            new InvoiceRepository(db);

        this.auditRepository =
            new AuditRepository(db);

        this.stateMachine =
            new SubscriptionStateMachine();
    }

    process(
        webhook: WebhookPayload,
    ): WebhookProcessResult {
        const claimed =
            this.webhookRepository.tryClaim(
                webhook.eventId,
                webhook.eventType,
            );

        if (!claimed) {
            this.webhookRepository.markDuplicate(
                webhook.eventId,
            );

            const subscription =
                this.subscriptionRepository.getById(
                    webhook.subscriptionId,
                );

            if (!subscription) {
                throw new Error(
                    `Subscription "${webhook.subscriptionId}" not found`,
                );
            }

            return {
                duplicate: true,
                subscriptionId:
                    subscription.id,
                status:
                    subscription.status,
            };
        }

        try {
            const result =
                this.processNewWebhook(
                    webhook,
                );

            return result;
        } catch (error) {
            this.webhookRepository.markFailed(
                webhook.eventId,
            );

            throw error;
        }
    }

    private processNewWebhook(
        webhook: WebhookPayload,
    ): WebhookProcessResult {
        const subscription =
            this.subscriptionRepository.getById(
                webhook.subscriptionId,
            );

        if (!subscription) {
            throw new Error(
                `Subscription "${webhook.subscriptionId}" not found`,
            );
        }

        /*
         * A refund affects the invoice but does not
         * transition subscription state.
         */
        if (
            webhook.eventType ===
            'payment.refunded'
        ) {
            return this.processRefund(
                subscription.id,
                subscription.status,
                webhook,
            );
        }

        const trigger =
            this.getTrigger(
                subscription.status,
                webhook.eventType,
            );

        const newState =
            this.stateMachine.transition(
                subscription.status,
                trigger,
            );

        const now =
            new Date().toISOString();

        runInTransaction(
            this.db,
            () => {
                this.subscriptionRepository.updateStatus(
                    subscription.id,
                    newState,
                    now,
                );

                if (
                    webhook.eventType ===
                    'payment.succeeded'
                ) {
                    this.createSuccessfulInvoice(
                        subscription.id,
                        subscription.plan,
                    );
                }

                this.auditRepository.create({
                    subscriptionId:
                        subscription.id,
                    oldState:
                        subscription.status,
                    newState,
                    eventType:
                        webhook.eventType,
                    correlationId:
                        webhook.correlationId,
                    createdAt: now,
                });

                this.webhookRepository.markProcessed(
                    webhook.eventId,
                );
            },
        );

        return {
            duplicate: false,
            subscriptionId:
                subscription.id,
            status: newState,
        };
    }

    private getTrigger(
        currentState:
            | 'trialing'
            | 'active'
            | 'past_due'
            | 'canceled',
        eventType: Exclude<
            WebhookEventType,
            'payment.refunded'
        >,
    ): Trigger {
        if (
            eventType ===
            'payment.succeeded'
        ) {
            if (
                currentState ===
                'past_due'
            ) {
                return Trigger.RetrySucceeded;
            }

            return Trigger.PaymentSucceeded;
        }

        return Trigger.PaymentFailed;
    }

    private createSuccessfulInvoice(
        subscriptionId: string,
        plan: string,
    ): void {
        const existingInvoices =
            this.invoiceRepository
                .getBySubscriptionId(
                    subscriptionId,
                );

        const hasSuccessfulInvoice =
            existingInvoices.some(
                (invoice) =>
                    invoice.status ===
                    'succeeded',
            );

        if (hasSuccessfulInvoice) {
            return;
        }

        const amount =
            PLAN_PRICES[plan];

        if (amount === undefined) {
            throw new Error(
                `Unsupported plan "${plan}"`,
            );
        }

        this.invoiceRepository.create({
            id:
                `inv-${crypto.randomUUID()}`,
            subscriptionId,
            amount,
            currency: 'USD',
            status: 'succeeded',
        });
    }

    private processRefund(
        subscriptionId: string,
        currentState: string,
        webhook: WebhookPayload,
    ): WebhookProcessResult {
        const now =
            new Date().toISOString();

        runInTransaction(
            this.db,
            () => {
                this.refundLatestInvoice(
                    subscriptionId,
                );

                /*
                 * Refund does not change subscription
                 * state under the current contract.
                 */
                this.auditRepository.create({
                    subscriptionId,
                    oldState: currentState,
                    newState: currentState,
                    eventType:
                        webhook.eventType,
                    correlationId:
                        webhook.correlationId,
                    createdAt: now,
                });

                this.webhookRepository.markProcessed(
                    webhook.eventId,
                );
            },
        );

        return {
            duplicate: false,
            subscriptionId,
            status: currentState,
        };
    }

    private refundLatestInvoice(
        subscriptionId: string,
    ): void {
        const invoices =
            this.invoiceRepository
                .getBySubscriptionId(
                    subscriptionId,
                );

        const latest =
            invoices
                .slice()
                .reverse()
                .find(
                    (invoice) =>
                        invoice.status ===
                        'succeeded',
                );

        if (!latest) {
            return;
        }

        this.invoiceRepository.updateStatus(
            latest.id,
            'refunded',
        );
    }
}