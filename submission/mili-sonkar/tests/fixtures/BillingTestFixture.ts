import type { DatabaseSync } from 'node:sqlite';
import type { Express } from 'express';
import { createApp } from '../../src/app/app.js';
import { createDatabase } from '../../src/infrastructure/sqlite/db.js';
import { MockPaymentProvider } from '../../src/infrastructure/payment-provider/MockPaymentProvider.js';
import { SubscriptionRepository } from '../../src/infrastructure/repositories/SubscriptionRepository.js';
import { InvoiceRepository } from '../../src/infrastructure/repositories/InvoiceRepository.js';
import { WebhookRepository } from '../../src/infrastructure/repositories/WebhookRepository.js';
import { AuditRepository } from '../../src/infrastructure/repositories/AuditRepository.js';
import { IdempotencyKeyRepository } from '../../src/infrastructure/repositories/IdempotencyKeyRepository.js';
import { ReconciliationRepository } from '../../src/infrastructure/repositories/ReconciliationRepository.js';
import { SubscriptionApiClient } from '../clients/SubscriptionApiClient.js';
import { WebhookApiClient } from '../clients/WebhookApiClient.js';
import { SubscriptionValidator } from '../validators/SubscriptionValidator.js';
import { InvoiceValidator } from '../validators/InvoiceValidator.js';
import { StateTransitionValidator } from '../validators/StateTransitionValidator.js';
import { ProviderInteractionValidator } from '../validators/ProviderInteractionValidator.js';
import { PersistenceValidator } from '../validators/PersistenceValidator.js';

export class BillingTestFixture {
    readonly db: DatabaseSync;
    readonly app: Express;
    readonly webhookSecret: string;
    readonly paymentProviderMock: MockPaymentProvider;
    readonly subscriptionClient: SubscriptionApiClient;
    readonly webhookClient: WebhookApiClient;
    readonly subscriptionRepository: SubscriptionRepository;
    readonly invoiceRepository: InvoiceRepository;
    readonly webhookRepository: WebhookRepository;
    readonly idempotencyKeyRepository: IdempotencyKeyRepository;
    readonly auditRepository: AuditRepository;
    readonly reconciliationRepository: ReconciliationRepository;
    readonly subscriptionValidator: SubscriptionValidator;
    readonly invoiceValidator: InvoiceValidator;
    readonly stateValidator: StateTransitionValidator;
    readonly persistenceValidator: PersistenceValidator;
    readonly providerValidator: ProviderInteractionValidator;

    constructor(webhookSecret = 'test-webhook-secret') {
        this.db = createDatabase();
        this.webhookSecret = webhookSecret;
        this.paymentProviderMock = new MockPaymentProvider();
        this.app = createApp({
            db: this.db,
            paymentProvider: this.paymentProviderMock,
            webhookSecret,
        });

        this.subscriptionClient = new SubscriptionApiClient(this.app);
        this.webhookClient = new WebhookApiClient(this.app, webhookSecret);
        this.subscriptionRepository = new SubscriptionRepository(this.db);
        this.invoiceRepository = new InvoiceRepository(this.db);
        this.webhookRepository = new WebhookRepository(this.db);
        this.idempotencyKeyRepository = new IdempotencyKeyRepository(this.db);
        this.auditRepository = new AuditRepository(this.db);
        this.reconciliationRepository = new ReconciliationRepository(this.db);
        this.subscriptionValidator = new SubscriptionValidator();
        this.invoiceValidator = new InvoiceValidator();
        this.stateValidator = new StateTransitionValidator();
        this.persistenceValidator = new PersistenceValidator();
        this.providerValidator = new ProviderInteractionValidator();
    }

    close(): void {
        this.db.close();
    }
}
