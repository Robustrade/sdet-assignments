
import request from 'supertest';
import { createHmac } from 'crypto';

import { createApp } from '../../src/index';
import { createDatabase } from '../../src/utils/database';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { WebhookEventRepository } from '../../src/repositories/WebhookEventRepository';
import { InvoicePaymentRepository } from '../../src/repositories/InvoicePaymentRepository';
import { SubscriptionStateMachine } from '../../src/state-machine/SubscriptionStateMachine';
import { MockPaymentProvider } from '../../src/providers/PaymentProvider';
import { SubscriptionService } from '../../src/services/SubscriptionService';
import { PaymentWebhookHandler } from '../../src/services/PaymentWebhookHandler';
import { WebhookSignatureVerifier } from '../../src/utils/WebhookSignature';

describe('Subscription Lifecycle E2E', () => {
    const secret = 'test-webhook-secret';

    let db: ReturnType<typeof createDatabase>;
    let app: ReturnType<typeof createApp>;

    function signPayload(payload: string): string {
        return createHmac('sha256', secret)
            .update(Buffer.from(payload))
            .digest('hex');
    }

    beforeEach(() => {
        db = createDatabase();

        const subscriptionRepository = new SubscriptionRepository(db);
        const stateMachine = new SubscriptionStateMachine();
        const paymentProvider = new MockPaymentProvider();

        const service = new SubscriptionService(
            subscriptionRepository,
            stateMachine,
            paymentProvider
        );

        const webhookRepository = new WebhookEventRepository(db);
        const invoicePaymentRepository = new InvoicePaymentRepository(db);

        const handler = new PaymentWebhookHandler(
            service,
            webhookRepository,
            invoicePaymentRepository
        );

        const verifier = new WebhookSignatureVerifier(secret);

        app = createApp(handler, verifier, service);
    });

    afterEach(() => {
        db.close();
    });

    it('should create a subscription, process payment webhook and persist active status', async () => {
        // Step 1: Create subscription through API
        const createResponse = await request(app)
            .post('/subscriptions')
            .send({
                customerId: 'customer-e2e-001',
                plan: 'basic',
                paymentMethodId: 'pm-e2e-001'
            });

        expect(createResponse.status).toBe(201);
        expect(createResponse.body.success).toBe(true);
        expect(createResponse.body.subscription.id).toBeDefined();
        expect(createResponse.body.subscription.status).toBe('trialing');

        const subscriptionId = createResponse.body.subscription.id;

        // Step 2: Send signed payment-success webhook
        const payload = JSON.stringify({
            event_id: 'evt-e2e-001',
            type: 'payment.succeeded',
            subscription_id: subscriptionId,
            invoice_id: 'inv-e2e-001',
            amount: 1000,
            currency: 'USD'
        });

        const webhookResponse = await request(app)
            .post('/webhooks/payment-provider')
            .set('Content-Type', 'application/json')
            .set('X-Provider-Signature', signPayload(payload))
            .send(payload);

        expect(webhookResponse.status).toBe(200);
        expect(webhookResponse.body.processed).toBe(true);

        // Step 3: Retrieve subscription through API
        const getResponse = await request(app)
            .get(`/subscriptions/${subscriptionId}`);


        expect(getResponse.status).toBe(200);
        expect(getResponse.body.success).toBe(true);
        expect(getResponse.body.subscription.id).toBe(subscriptionId);
        expect(getResponse.body.subscription.status).toBe('active');

        // Step 4: Verify payment outcome persisted in database
        const paymentRepository = new InvoicePaymentRepository(db);

        expect(paymentRepository.getStatus('inv-e2e-001')).toBe('succeeded');
    });
});
