
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

describe('Payment Webhook API', () => {
    const secret = 'test-webhook-secret';

    let db: ReturnType<typeof createDatabase>;
    let service: SubscriptionService;
    let app: ReturnType<typeof createApp>;

    function signPayload(payload: string): string {
        return createHmac('sha256', secret)
            .update(Buffer.from(payload))
            .digest('hex');
    }

    async function createTestSubscription(): Promise<string> {
        const subscription = await service.createSubscription({
            customerId: 'customer-api-001',
            plan: 'basic',
            paymentMethodId: 'pm-api-001'
        });

        return subscription.id;
    }

    function createValidWebhookPayload(
        subscriptionId: string,
        eventId: string,
        invoiceId: string
    ): string {
        const subscription = service.getSubscription(subscriptionId);

        return JSON.stringify({
            event_id: eventId,
            type: 'payment.succeeded',
            subscription_id: subscriptionId,
            invoice_id: invoiceId,
            amount: subscription.amount,
            currency: subscription.currency
        });
    }


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

        const verifier = new WebhookSignatureVerifier(secret);

        app = createApp(handler, verifier, service);
    });

    afterEach(() => {
        db.close();
    });

    it('should accept a valid signed webhook', async () => {
        const subscriptionId = await createTestSubscription();

        const payload = createValidWebhookPayload(
            subscriptionId,
            'evt-api-001',
            'inv-api-001'
        );

        const response = await request(app)
            .post('/webhooks/payment-provider')
            .set('Content-Type', 'application/json')
            .set('X-Provider-Signature', signPayload(payload))
            .send(payload);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.processed).toBe(true);
        expect(service.getSubscription(subscriptionId).status).toBe('active');
    });

    it('should reject an invalid webhook signature', async () => {
        const subscriptionId = await createTestSubscription();

        const payload = JSON.stringify({
            event_id: 'evt-api-002',
            type: 'payment.succeeded',
            subscription_id: subscriptionId,
            invoice_id: 'inv-api-002',
            amount: 100,
            currency: 'USD'
        });

        const response = await request(app)
            .post('/webhooks/payment-provider')
            .set('Content-Type', 'application/json')
            .set('X-Provider-Signature', 'invalid-signature')
            .send(payload);

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid webhook signature');
        expect(service.getSubscription(subscriptionId).status).toBe('trialing');
    });

    it('should reject malformed JSON payloads', async () => {
        const payload = '{"event_id":';

        const response = await request(app)
            .post('/webhooks/payment-provider')
            .set('Content-Type', 'application/json')
            .set('X-Provider-Signature', signPayload(payload))
            .send(payload);

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Malformed JSON payload');
    });

    it('should reject requests without a signature', async () => {
        const payload = JSON.stringify({
            event_id: 'evt-api-003',
            type: 'payment.succeeded',
            subscription_id: 'sub-001',
            invoice_id: 'inv-api-003',
            amount: 100,
            currency: 'USD'
        });

        const response = await request(app)
            .post('/webhooks/payment-provider')
            .set('Content-Type', 'application/json')
            .send(payload);

        expect(response.status).toBe(401);
        expect(response.body.error).toBe('Invalid webhook signature');
    });

    it('should process duplicate webhooks only once', async () => {
        const subscriptionId = await createTestSubscription();

        const payload = createValidWebhookPayload(
            subscriptionId,
            'evt-api-004',
            'inv-api-004'
        );

        const signature = signPayload(payload);

        const firstResponse = await request(app)
            .post('/webhooks/payment-provider')
            .set('Content-Type', 'application/json')
            .set('X-Provider-Signature', signature)
            .send(payload);

        const secondResponse = await request(app)
            .post('/webhooks/payment-provider')
            .set('Content-Type', 'application/json')
            .set('X-Provider-Signature', signature)
            .send(payload);

        expect(firstResponse.status).toBe(200);
        expect(firstResponse.body.processed).toBe(true);

        expect(secondResponse.status).toBe(200);
        expect(secondResponse.body.processed).toBe(false);

        expect(service.getSubscription(subscriptionId).status).toBe('active');
    });

    it('should reject a webhook with an invalid event payload', async () => {
        const subscriptionId = await createTestSubscription();

        const payload = JSON.stringify({
            event_id: 'evt-api-invalid',
            type: 'payment.unknown',
            subscription_id: subscriptionId,
            invoice_id: 'inv-api-invalid',
            amount: 100,
            currency: 'USD'
        });

        const response = await request(app)
            .post('/webhooks/payment-provider')
            .set('Content-Type', 'application/json')
            .set('X-Provider-Signature', signPayload(payload))
            .send(payload);

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid webhook event payload');
    });
});
