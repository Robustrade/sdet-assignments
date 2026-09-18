import { afterEach, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../../src/infrastructure/payment-provider/MockPaymentProvider.js';
import request from 'supertest';

import { createApp } from '../../src/app/app.js';
import { createDatabase } from '../../src/infrastructure/sqlite/db.js';

describe('Subscription API', () => {
    let db: ReturnType<typeof createDatabase>;

    afterEach(() => {
        db?.close();
    });

    it('creates a basic subscription through the HTTP API', async () => {
        db = createDatabase();

        const app = createApp({
            db,
        });

        const response = await request(app)
            .post('/subscriptions')
            .set('Idempotency-Key', 'idem-api-001')
            .set('X-Correlation-ID', 'corr-api-001')
            .send({
                customerId: 'customer-001',
                plan: 'basic',
            });

        expect(response.status).toBe(201);

        expect(response.body.subscription).toMatchObject({
            customerId: 'customer-001',
            plan: 'basic',
            status: 'trialing',
        });

        expect(response.body.subscription.id).toBeTypeOf('string');
    });

    it('persists the created subscription with the same state returned by the API', async () => {
        db = createDatabase();

        const app = createApp({
            db,
        });

        const response = await request(app)
            .post('/subscriptions')
            .set('Idempotency-Key', 'idem-api-persistence-001')
            .set('X-Correlation-ID', 'corr-api-persistence-001')
            .send({
                customerId: 'customer-persistence-001',
                plan: 'basic',
            });

        expect(response.status).toBe(201);

        const apiSubscription =
            response.body.subscription;

        const row = db
            .prepare(`
                SELECT
                    id,
                    customer_id,
                    plan,
                    status,
                    created_at,
                    updated_at
                FROM subscriptions
                WHERE id = ?
            `)
            .get(apiSubscription.id) as
            | {
                id: string;
                customer_id: string;
                plan: string;
                status: string;
                created_at: string;
                updated_at: string;
            }
            | undefined;

        expect(row).toBeDefined();

        expect(row).toMatchObject({
            id: apiSubscription.id,
            customer_id: 'customer-persistence-001',
            plan: 'basic',
            status: 'trialing',
            created_at: apiSubscription.createdAt,
            updated_at: apiSubscription.updatedAt,
        });
    });
    it('creates a pro subscription with a successful invoice and exactly one provider charge', async () => {
        db = createDatabase();

        const paymentProvider = new MockPaymentProvider();

        const app = createApp({
            db,
            paymentProvider,
        });

        const response = await request(app)
            .post('/subscriptions')
            .set('Idempotency-Key', 'idem-pro-001')
            .set('X-Correlation-ID', 'corr-pro-001')
            .send({
                customerId: 'customer-pro-001',
                plan: 'pro',
            });

        expect(response.status).toBe(201);

        expect(response.body.subscription).toMatchObject({
            customerId: 'customer-pro-001',
            plan: 'pro',
            status: 'active',
        });

        expect(response.body.invoice).toMatchObject({
            subscriptionId: response.body.subscription.id,
            amount: 4900,
            currency: 'USD',
            status: 'succeeded',
        });

        expect(response.body.providerPaymentId).toBeTypeOf('string');

        expect(paymentProvider.getChargeCount()).toBe(1);

        expect(paymentProvider.getCharges()[0]).toMatchObject({
            subscriptionId: response.body.subscription.id,
            amount: 4900,
            currency: 'USD',
        });

        const invoice = db
            .prepare(`
            SELECT
                id,
                subscription_id,
                amount,
                currency,
                status
            FROM invoices
            WHERE subscription_id = ?
        `)
            .get(response.body.subscription.id) as
            | {
                id: string;
                subscription_id: string;
                amount: number;
                currency: string;
                status: string;
            }
            | undefined;

        expect(invoice).toBeDefined();

        expect(invoice).toMatchObject({
            subscription_id: response.body.subscription.id,
            amount: 4900,
            currency: 'USD',
            status: 'succeeded',
        });
    });
    it('replays the same response for a repeated idempotency key without duplicating billing effects', async () => {
        db = createDatabase();

        const paymentProvider = new MockPaymentProvider();

        const app = createApp({
            db,
            paymentProvider,
        });

        const payload = {
            customerId: 'customer-idempotent-001',
            plan: 'pro',
        };

        const firstResponse = await request(app)
            .post('/subscriptions')
            .set('Idempotency-Key', 'idem-replay-001')
            .set('X-Correlation-ID', 'corr-idem-001')
            .send(payload);

        const secondResponse = await request(app)
            .post('/subscriptions')
            .set('Idempotency-Key', 'idem-replay-001')
            .set('X-Correlation-ID', 'corr-idem-002')
            .send(payload);

        expect(firstResponse.status).toBe(201);
        expect(secondResponse.status).toBe(201);

        expect(secondResponse.body).toEqual(
            firstResponse.body,
        );

        const subscriptions = db
            .prepare(`
            SELECT id
            FROM subscriptions
            WHERE customer_id = ?
        `)
            .all(payload.customerId) as Array<{
                id: string;
            }>;

        expect(subscriptions).toHaveLength(1);

        const invoices = db
            .prepare(`
            SELECT id
            FROM invoices
            WHERE subscription_id = ?
        `)
            .all(firstResponse.body.subscription.id) as Array<{
                id: string;
            }>;

        expect(invoices).toHaveLength(1);

        expect(paymentProvider.getChargeCount()).toBe(1);

        const idempotencyRecord = db
            .prepare(`
            SELECT
                key,
                subscription_id,
                response_status,
                status
            FROM idempotency_keys
            WHERE key = ?
        `)
            .get('idem-replay-001') as
            | {
                key: string;
                subscription_id: string;
                response_status: number;
                status: string;
            }
            | undefined;

        expect(idempotencyRecord).toBeDefined();

        expect(idempotencyRecord).toMatchObject({
            key: 'idem-replay-001',
            subscription_id:
                firstResponse.body.subscription.id,
            response_status: 201,
            status: 'complete',
        });
    });
    it('returns 400 when customerId is missing', async () => {
        db = createDatabase();

        const app = createApp({
            db,
        });

        const response = await request(app)
            .post('/subscriptions')
            .set('Idempotency-Key', 'idem-api-002')
            .send({
                plan: 'basic',
            });

        expect(response.status).toBe(400);
    });

    it('returns 400 for an unsupported plan', async () => {
        db = createDatabase();

        const app = createApp({
            db,
        });

        const response = await request(app)
            .post('/subscriptions')
            .set('Idempotency-Key', 'idem-api-003')
            .send({
                customerId: 'customer-003',
                plan: 'enterprise',
            });

        expect(response.status).toBe(400);
    });

    it('returns 404 for a subscription that does not exist', async () => {
        db = createDatabase();

        const app = createApp({
            db,
        });

        const response = await request(app)
            .get('/subscriptions/sub-does-not-exist');

        expect(response.status).toBe(404);
    });

});
