import type { PaymentProvider } from '../infrastructure/payment-provider/PaymentProvider.js';
import type { Subscription, Plan } from '../domain/Subscription.js';
import type { SubscriptionState } from '../domain/SubscriptionState.js';
import { Trigger } from '../domain/SubscriptionState.js';
import { SubscriptionStateMachine } from '../domain/SubscriptionStateMachine.js';
import type { Invoice } from '../domain/Invoice.js';
import { AuditRepository } from '../infrastructure/repositories/AuditRepository.js';
import { IdempotencyKeyRepository } from '../infrastructure/repositories/IdempotencyKeyRepository.js';
import { InvoiceRepository } from '../infrastructure/repositories/InvoiceRepository.js';
import { SubscriptionRepository } from '../infrastructure/repositories/SubscriptionRepository.js';
import { runInTransaction } from '../infrastructure/sqlite/db.js';
import type { DatabaseSync } from 'node:sqlite';

export interface CreateSubscriptionRequest {
    customerId: string;
    plan: Plan;
    idempotencyKey?: string;
    correlationId: string;
}

export interface CreateSubscriptionResponse {
    subscription: Subscription;
    invoice?: Invoice;
    providerPaymentId?: string;
}

export interface CreateSubscriptionResult {
    body: CreateSubscriptionResponse;
    statusCode: number;
}

export class ProviderChargeReconciliationError extends Error {
    constructor(
        public readonly providerPaymentId: string,
        message: string,
    ) {
        super(message);
        this.name = 'ProviderChargeReconciliationError';
    }
}

const PLAN_CONFIG: Record<
    Plan,
    {
        price: number;
        trialDays: number;
        immediateCharge: boolean;
    }
> = {
    basic: {
        price: 1900,
        trialDays: 14,
        immediateCharge: false,
    },
    pro: {
        price: 4900,
        trialDays: 0,
        immediateCharge: true,
    },
};

export class SubscriptionService {
    private readonly subscriptionRepository: SubscriptionRepository;
    private readonly invoiceRepository: InvoiceRepository;
    private readonly auditRepository: AuditRepository;
    private readonly idempotencyRepository: IdempotencyKeyRepository;
    private readonly stateMachine: SubscriptionStateMachine;

    constructor(
        private readonly db: DatabaseSync,
        private readonly paymentProvider: PaymentProvider,
    ) {
        this.subscriptionRepository =
            new SubscriptionRepository(db);

        this.invoiceRepository =
            new InvoiceRepository(db);

        this.auditRepository =
            new AuditRepository(db);

        this.idempotencyRepository =
            new IdempotencyKeyRepository(db);

        this.stateMachine =
            new SubscriptionStateMachine();
    }

    createSubscription(
        request: CreateSubscriptionRequest,
    ): CreateSubscriptionResult {
        const now = new Date().toISOString();

        if (request.idempotencyKey) {
            const claimed = this.idempotencyRepository.claim(
                request.idempotencyKey,
                now,
            );

            if (!claimed) {
                const existing =
                    this.idempotencyRepository.getByKey(
                        request.idempotencyKey,
                    );

                if (!existing) {
                    throw new Error(
                        'Unable to claim idempotency key',
                    );
                }

                if (existing.status === 'pending') {
                    throw new Error(
                        'Idempotency key is already being processed',
                    );
                }

                if (
                    existing.responseStatus === null ||
                    existing.responseBody === null
                ) {
                    throw new Error(
                        'Completed idempotency key has no stored response',
                    );
                }

                return {
                    body: JSON.parse(
                        existing.responseBody,
                    ) as CreateSubscriptionResponse,
                    statusCode: existing.responseStatus,
                };
            }
        }

        try {
            const result =
                this.createSubscriptionInternal(
                    request,
                    now,
                );

            return {
                body: result,
                statusCode: 201,
            };
        } catch (error) {
            if (request.idempotencyKey) {
                this.idempotencyRepository.release(
                    request.idempotencyKey,
                );
            }

            throw error;
        }
    }

    getSubscription(
        id: string,
    ): Subscription | undefined {
        return this.subscriptionRepository.getById(id);
    }

    cancelSubscription(
        id: string,
        correlationId: string,
    ): Subscription {
        const existing =
            this.subscriptionRepository.getById(id);

        if (!existing) {
            throw new Error(
                `Subscription "${id}" not found`,
            );
        }

        const newState =
            this.stateMachine.transition(
                existing.status,
                Trigger.CancelRequested,
            );

        const now = new Date().toISOString();

        runInTransaction(this.db, () => {
            this.subscriptionRepository.updateStatus(
                id,
                newState,
                now,
            );

            this.auditRepository.create({
                subscriptionId: id,
                oldState: existing.status,
                newState,
                eventType: 'subscription.canceled',
                correlationId,
                createdAt: now,
            });
        });

        return (
            this.subscriptionRepository.getById(id)!
        );
    }

    private createSubscriptionInternal(
        request: CreateSubscriptionRequest,
        now: string,
    ): CreateSubscriptionResponse {
        const plan = PLAN_CONFIG[request.plan];

        const subscriptionId =
            this.generateId('sub');

        let invoice: Invoice | undefined;
        let providerPaymentId: string | undefined;

        if (plan.immediateCharge) {
            const payment =
                this.paymentProvider.charge({
                    subscriptionId,
                    amount: plan.price,
                    currency: 'USD',
                });

            if (!payment.success) {
                throw new Error(
                    payment.errorMessage ??
                    'Payment failed',
                );
            }

            providerPaymentId =
                payment.providerPaymentId;
        }

        const initialState: SubscriptionState =
            plan.immediateCharge
                ? 'active'
                : 'trialing';

        const subscription: Subscription = {
            id: subscriptionId,
            customerId: request.customerId,
            plan: request.plan,
            status: initialState,
            createdAt: now,
            updatedAt: now,
        };

        if (plan.immediateCharge) {
            invoice = {
                id: this.generateId('inv'),
                subscriptionId,
                amount: plan.price,
                currency: 'USD',
                status: 'succeeded',
            };
        }

        try {
            runInTransaction(this.db, () => {
                this.subscriptionRepository.create(
                    subscription,
                );

                if (invoice) {
                    this.invoiceRepository.create(
                        invoice,
                    );
                }

                this.auditRepository.create({
                    subscriptionId,
                    oldState: null,
                    newState: initialState,
                    eventType: 'subscription.created',
                    correlationId:
                        request.correlationId,
                    createdAt: now,
                });

                if (request.idempotencyKey) {
                    this.idempotencyRepository.complete(
                        request.idempotencyKey,
                        subscriptionId,
                        201,
                        JSON.stringify({
                            subscription,
                            invoice,
                            providerPaymentId,
                        }),
                    );
                }
            });
        } catch (error) {
            if (providerPaymentId) {
                throw new ProviderChargeReconciliationError(
                    providerPaymentId,
                    `Payment ${providerPaymentId} succeeded but local persistence failed`,
                );
            }

            throw error;
        }

        return {
            subscription,
            invoice,
            providerPaymentId,
        };
    }

    private generateId(
        prefix: string,
    ): string {
        return `${prefix}-${crypto.randomUUID()}`;
    }
}