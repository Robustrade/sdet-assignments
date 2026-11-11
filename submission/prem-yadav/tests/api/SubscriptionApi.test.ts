import { CreateSubscriptionInput } from '../../src/services/SubscriptionService';
import request from 'supertest';
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

describe('Subscription API', () => {
    let db: ReturnType<typeof createDatabase>;
    let service: SubscriptionService;
    let app: ReturnType<typeof createApp>;

    const validSubscription: CreateSubscriptionInput = {
        customerId: 'customer-001',
        plan: 'basic',
        paymentMethodId: 'pm-001'
    };

    beforeEach(() => {
        db = createDatabase();

        const subscriptionRepository = new SubscriptionRepository(db);
        const stateMachine = new SubscriptionStateMachine();
        const paymentProvider = new MockPaymentProvider('timeout');

        service = new SubscriptionService(
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

        const verifier = new WebhookSignatureVerifier('test-secret');

        app = createApp(handler, verifier, service);
    });

    afterEach(() => {
        db.close();
    });

    it('should create a subscription successfully', async () => {
        const response = await request(app)
            .post('/subscriptions')
            .send(validSubscription);

        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
        expect(response.body.subscription.customerId).toBe('customer-001');
        expect(response.body.subscription.plan).toBe('basic');
        expect(response.body.subscription.status).toBe('trialing');
    });

    it('should retrieve an existing subscription', async () => {
        const created = await service.createSubscription(validSubscription);

        const response = await request(app)
            .get(`/subscriptions/${created.id}`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.subscription.id).toBe(created.id);
    });

    it('should cancel an existing subscription', async () => {
        const created = await service.createSubscription(validSubscription);

        const response = await request(app)
            .post(`/subscriptions/${created.id}/cancel`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.subscription.status).toBe('canceled');
    });

    it('should reject subscription creation when required fields are missing', async () => {
        const response = await request(app)
            .post('/subscriptions')
            .send({
                customerId: 'customer-001',
                plan: 'basic'
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe(
            'customerId, plan and paymentMethodId are required'
        );
    });

    it('should reject an invalid subscription plan', async () => {
        const response = await request(app)
            .post('/subscriptions')
            .send({
                customerId: 'customer-001',
                plan: 'premium',
                paymentMethodId: 'pm-001'
            });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid subscription plan');
    });

    it('should return 404 when retrieving an unknown subscription', async () => {
        const response = await request(app)
            .get('/subscriptions/unknown-subscription');

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Subscription not found');
    });

    it('should return 404 when cancelling an unknown subscription', async () => {
        const response = await request(app)
            .post('/subscriptions/unknown-subscription/cancel');

        expect(response.status).toBe(404);
        expect(response.body.error).toBe('Subscription not found');
    });
});
