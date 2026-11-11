import { PaymentWebhookEventBuilder } from '../../src/builders/PaymentWebhookEventBuilder';
import { InvoicePaymentRepository } from '../../src/repositories/InvoicePaymentRepository';
import { createDatabase } from '../../src/utils/database';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository';
import { WebhookEventRepository } from '../../src/repositories/WebhookEventRepository';
import { SubscriptionStateMachine } from '../../src/state-machine/SubscriptionStateMachine';
import { MockPaymentProvider } from '../../src/providers/PaymentProvider';
import { SubscriptionService } from '../../src/services/SubscriptionService';
import {
    PaymentWebhookHandler,
    PaymentWebhookEvent
} from '../../src/services/PaymentWebhookHandler';

describe('PaymentWebhookHandler', () => {
    let db: ReturnType<typeof createDatabase>;
    let service: SubscriptionService;
    let webhookRepository: WebhookEventRepository;
    let handler: PaymentWebhookHandler;
    let paymentProvider: MockPaymentProvider;

    beforeEach(() => {
        db = createDatabase();

        const repository = new SubscriptionRepository(db);
        const stateMachine = new SubscriptionStateMachine();
        paymentProvider = new MockPaymentProvider('timeout');

        service = new SubscriptionService(
            repository,
            stateMachine,
            paymentProvider
        );

        webhookRepository = new WebhookEventRepository(db);

        const invoicePaymentRepository = new InvoicePaymentRepository(db);

        handler = new PaymentWebhookHandler(
            service,
            webhookRepository,
            invoicePaymentRepository
        );
    });

    afterEach(() => {
        db.close();
    });

    async function createTestSubscription(): Promise<string> {
        paymentProvider.setNextStatus('timeout');
        const subscription = await service.createSubscription({
            customerId: 'customer-001',
            plan: 'basic',
            paymentMethodId: 'pm-001'
        });

        return subscription.id;
    }



    function createEvent(
        subscriptionId: string,
        eventId = 'evt-001',
        type: PaymentWebhookEvent['type'] = 'payment.succeeded'
    ): PaymentWebhookEvent {
        let amount = 1000;
        let currency = 'USD';

        try {
            const subscription = service.getSubscription(subscriptionId);
            amount = subscription.amount;
            currency = subscription.currency;
        } catch {
            // Keep defaults for tests that intentionally use unknown subscriptions.
        }

        return new PaymentWebhookEventBuilder()
            .withEventId(eventId)
            .withType(type)
            .withSubscriptionId(subscriptionId)
            .withInvoiceId('inv-001')
            .withAmount(amount)
            .withCurrency(currency)
            .build();
    }



    it('should activate a trialing subscription after successful payment', async () => {
        const id = await createTestSubscription();

        const result = handler.handle(createEvent(id));

        expect(result.processed).toBe(true);
        expect(service.getSubscription(id).status).toBe('active');
    });

    it('should process the same webhook only once', async () => {
        const id = await createTestSubscription();
        const event = createEvent(id);

        expect(handler.handle(event).processed).toBe(true);
        expect(handler.handle(event).processed).toBe(false);
    });

    it('should not reactivate a canceled subscription', async () => {
        const id = await createTestSubscription();

        service.cancelSubscription(id);

        const result = handler.handle(createEvent(id));

        expect(result.processed).toBe(true);
        expect(service.getSubscription(id).status).toBe('canceled');
    });

    it('should allow retrying an event after an unknown subscription error', async () => {
        const event = createEvent('sub-not-created');

        expect(() => handler.handle(event)).toThrow(
            'Subscription not found: sub-not-created'
        );

        const id = await createTestSubscription();
        const retryEvent = createEvent(id);

        expect(handler.handle(retryEvent).processed).toBe(true);
        expect(service.getSubscription(id).status).toBe('active');
    });

    it('should not regress an active subscription when a delayed payment.failed event arrives for the same invoice', async () => {
        const id = await createTestSubscription();

        handler.handle(
            createEvent(id, 'evt-success', 'payment.succeeded')
        );

        expect(service.getSubscription(id).status).toBe('active');

        handler.handle(
            createEvent(id, 'evt-failed', 'payment.failed')
        );

        expect(service.getSubscription(id).status).toBe('active');
    });

    it('should allow a successful payment to recover from an earlier failed payment for the same invoice', async () => {
        const id = await createTestSubscription();

        handler.handle(
            createEvent(id, 'evt-failed-first', 'payment.failed')
        );

        expect(service.getSubscription(id).status).toBe('past_due');

        handler.handle(
            createEvent(id, 'evt-success-later', 'payment.succeeded')
        );

        expect(service.getSubscription(id).status).toBe('active');
    });

    it('should track payment outcomes independently for different invoices', async () => {
        const id = await createTestSubscription();

        handler.handle(
            createEvent(id, 'evt-invoice-1', 'payment.succeeded')
        );

        const secondInvoiceEvent = {
            ...createEvent(id, 'evt-invoice-2', 'payment.failed'),
            invoice_id: 'inv-002'
        };

        handler.handle(secondInvoiceEvent);

        expect(service.getSubscription(id).status).toBe('past_due');
    });

    it('should not allow an invoice event to update the wrong subscription', async () => {
        const subscriptionA = await createTestSubscription();
        const subscriptionB = await createTestSubscription();

        expect(subscriptionA).not.toBe(subscriptionB);

        const invoiceId = 'inv-belongs-to-a';

        // Associate the invoice with subscription A.
        handler.handle({
            ...createEvent(
                subscriptionA,
                'evt-invoice-owner',
                'payment.succeeded'
            ),
            invoice_id: invoiceId
        });

        // Verify that the invoice was actually associated with A.
        const invoiceRecord = db.prepare(`
            SELECT subscription_id
            FROM invoice_payment_status
            WHERE invoice_id = ?
        `).get(invoiceId);

        expect(invoiceRecord).toEqual({
            subscription_id: subscriptionA
        });

        expect(service.getSubscription(subscriptionA).status).toBe('active');
        expect(service.getSubscription(subscriptionB).status).toBe('trialing');

        // Attempt to reuse A's invoice for subscription B.
        const wrongOwnerEvent = {
            ...createEvent(
                subscriptionB,
                'evt-wrong-owner',
                'payment.succeeded'
            ),
            invoice_id: invoiceId
        };

        expect(() => handler.handle(wrongOwnerEvent)).toThrow(
            'Invoice does not belong to this subscription'
        );

        // Neither subscription should be incorrectly modified.
        expect(service.getSubscription(subscriptionA).status).toBe('active');
        expect(service.getSubscription(subscriptionB).status).toBe('trialing');
    });

    it('should record a refund for a previously successful invoice', async () => {
        const id = await createTestSubscription();

        handler.handle(
            createEvent(id, 'evt-refund-success', 'payment.succeeded')
        );

        const refundResult = handler.handle(
            createEvent(id, 'evt-refund', 'payment.refunded')
        );

        expect(refundResult.processed).toBe(true);

        const payment = db.prepare(`
            SELECT status
            FROM invoice_payment_status
            WHERE invoice_id = ?
        `).get('inv-001') as { status: string };

        expect(payment.status).toBe('refunded');
    });

    it('should ignore a refund when the invoice was not successfully paid', async () => {
        const id = await createTestSubscription();

        handler.handle(
            createEvent(id, 'evt-failed-refund', 'payment.failed')
        );

        handler.handle(
            createEvent(id, 'evt-refund-after-failure', 'payment.refunded')
        );

        const payment = db.prepare(`
            SELECT status
            FROM invoice_payment_status
            WHERE invoice_id = ?
        `).get('inv-001') as { status: string };

        expect(payment.status).toBe('failed');
    });

    it('should ignore duplicate refund events', async () => {
        const id = await createTestSubscription();

        handler.handle(
            createEvent(id, 'evt-before-refund', 'payment.succeeded')
        );

        const refundEvent = createEvent(
            id,
            'evt-duplicate-refund',
            'payment.refunded'
        );

        expect(handler.handle(refundEvent).processed).toBe(true);
        expect(handler.handle(refundEvent).processed).toBe(false);

        const payment = db.prepare(`
            SELECT status
            FROM invoice_payment_status
            WHERE invoice_id = ?
        `).get('inv-001') as { status: string };

        expect(payment.status).toBe('refunded');
    });

    it('should not allow a refunded invoice to become successful again', async () => {
        const id = await createTestSubscription();

        handler.handle(
            createEvent(id, 'evt-original-success', 'payment.succeeded')
        );

        handler.handle(
            createEvent(id, 'evt-original-refund', 'payment.refunded')
        );

        handler.handle(
            createEvent(id, 'evt-late-success', 'payment.succeeded')
        );

        const payment = db.prepare(`
            SELECT status
            FROM invoice_payment_status
            WHERE invoice_id = ?
        `).get('inv-001') as { status: string };

        expect(payment.status).toBe('refunded');
    });


    it('should reject webhook with incorrect payment amount', async () => {
        const subscriptionId = await createTestSubscription();
        const subscription = service.getSubscription(subscriptionId);

        const event = {
            event_id: 'evt-wrong-amount',
            type: 'payment.succeeded' as const,
            subscription_id: subscriptionId,
            invoice_id: 'inv-wrong-amount',
            amount: subscription.amount + 100,
            currency: subscription.currency
        };

        expect(() => handler.handle(event)).toThrow(
            'Webhook payment amount or currency mismatch'
        );

        expect(service.getSubscription(subscriptionId).status).toBe('trialing');
    });

    it('should reject webhook with incorrect currency', async () => {
        const subscriptionId = await createTestSubscription();
        const subscription = service.getSubscription(subscriptionId);

        const event = {
            event_id: 'evt-wrong-currency',
            type: 'payment.succeeded' as const,
            subscription_id: subscriptionId,
            invoice_id: 'inv-wrong-currency',
            amount: subscription.amount,
            currency: 'EUR'
        };

        expect(() => handler.handle(event)).toThrow(
            'Webhook payment amount or currency mismatch'
        );

        expect(service.getSubscription(subscriptionId).status).toBe('trialing');
    });


});
