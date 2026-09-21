import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';

import request from 'supertest';

import {
    createHmac,
} from 'node:crypto';

import {
    createApp,
} from '../../src/app/app.js';

import {
    createDatabase,
} from '../../src/infrastructure/sqlite/db.js';

const WEBHOOK_SECRET =
    'test-webhook-secret';

function sign(body: string): string {
    return createHmac(
        'sha256',
        WEBHOOK_SECRET,
    )
        .update(body)
        .digest('hex');
}

describe('Webhook API', () => {
    let db:
        | ReturnType<typeof createDatabase>
        | undefined;

    afterEach(() => {
        db?.close();
        db = undefined;
    });

    async function createBasicSubscription() {
        const app = createApp({
            db: db!,
            webhookSecret:
                WEBHOOK_SECRET,
        });

        const response =
            await request(app)
                .post('/subscriptions')
                .set(
                    'Idempotency-Key',
                    `idem-${crypto.randomUUID()}`,
                )
                .send({
                    customerId:
                        `customer-${crypto.randomUUID()}`,
                    plan: 'basic',
                });

        expect(response.status)
            .toBe(201);

        return {
            app,
            subscriptionId:
                response.body.subscription.id,
        };
    }

    it('rejects a missing signature', async () => {
        db = createDatabase();

        const {
            app,
            subscriptionId,
        } =
            await createBasicSubscription();

        const response =
            await request(app)
                .post(
                    '/webhooks/payment-provider',
                )
                .send({
                    event_id:
                        'evt-no-signature',
                    event_type:
                        'payment.succeeded',
                    subscription_id:
                        subscriptionId,
                });

        expect(response.status)
            .toBe(401);

        const event = db
            .prepare(`
                SELECT event_id
                FROM webhook_events
                WHERE event_id = ?
            `)
            .get(
                'evt-no-signature',
            );

        expect(event).toBeUndefined();
    });

    it('rejects an invalid signature', async () => {
        db = createDatabase();

        const {
            app,
            subscriptionId,
        } =
            await createBasicSubscription();

        const body = JSON.stringify({
            event_id:
                'evt-invalid-signature',
            event_type:
                'payment.succeeded',
            subscription_id:
                subscriptionId,
        });

        const response =
            await request(app)
                .post(
                    '/webhooks/payment-provider',
                )
                .set(
                    'X-Webhook-Signature',
                    'sha256=invalid',
                )
                .send(body);

        expect(response.status)
            .toBe(401);

        const event = db
            .prepare(`
                SELECT event_id
                FROM webhook_events
                WHERE event_id = ?
            `)
            .get(
                'evt-invalid-signature',
            );

        expect(event).toBeUndefined();
    });

    it('processes a valid payment succeeded webhook', async () => {
        db = createDatabase();

        const {
            app,
            subscriptionId,
        } =
            await createBasicSubscription();

        const body = JSON.stringify({
            event_id:
                'evt-success-001',
            event_type:
                'payment.succeeded',
            subscription_id:
                subscriptionId,
        });

        const response =
            await request(app)
                .post(
                    '/webhooks/payment-provider',
                )
                .set(
                    'X-Webhook-Signature',
                    `sha256=${sign(body)}`,
                )
                .send(body);

        expect(response.status)
            .toBe(200);

        expect(
            response.body.duplicate,
        ).toBe(false);

        expect(
            response.body.status,
        ).toBe('active');

        const subscription =
            db
                .prepare(`
                    SELECT status
                    FROM subscriptions
                    WHERE id = ?
                `)
                .get(subscriptionId) as {
                    status: string;
                };

        expect(subscription.status)
            .toBe('active');

        const invoice =
            db
                .prepare(`
                    SELECT
                        amount,
                        currency,
                        status
                    FROM invoices
                    WHERE subscription_id = ?
                `)
                .get(subscriptionId) as {
                    amount: number;
                    currency: string;
                    status: string;
                };

        expect(invoice).toEqual({
            amount: 1900,
            currency: 'USD',
            status: 'succeeded',
        });
    });

    it('moves an active subscription to past_due on payment failure', async () => {
        db = createDatabase();

        const {
            app,
            subscriptionId,
        } =
            await createBasicSubscription();

        const successBody =
            JSON.stringify({
                event_id:
                    'evt-success-before-failure',
                event_type:
                    'payment.succeeded',
                subscription_id:
                    subscriptionId,
            });

        await request(app)
            .post(
                '/webhooks/payment-provider',
            )
            .set(
                'X-Webhook-Signature',
                `sha256=${sign(successBody)}`,
            )
            .send(successBody);

        const failureBody =
            JSON.stringify({
                event_id:
                    'evt-failure-001',
                event_type:
                    'payment.failed',
                subscription_id:
                    subscriptionId,
            });

        const response =
            await request(app)
                .post(
                    '/webhooks/payment-provider',
                )
                .set(
                    'X-Webhook-Signature',
                    `sha256=${sign(failureBody)}`,
                )
                .send(failureBody);

        expect(response.status)
            .toBe(200);

        expect(response.body.status)
            .toBe('past_due');
    });

    it('replays a duplicate webhook without creating another invoice', async () => {
        db = createDatabase();

        const {
            app,
            subscriptionId,
        } =
            await createBasicSubscription();

        const body = JSON.stringify({
            event_id:
                'evt-duplicate-001',
            event_type:
                'payment.succeeded',
            subscription_id:
                subscriptionId,
        });

        const signature =
            `sha256=${sign(body)}`;

        const first =
            await request(app)
                .post(
                    '/webhooks/payment-provider',
                )
                .set(
                    'X-Webhook-Signature',
                    signature,
                )
                .send(body);

        const second =
            await request(app)
                .post(
                    '/webhooks/payment-provider',
                )
                .set(
                    'X-Webhook-Signature',
                    signature,
                )
                .send(body);

        expect(first.status)
            .toBe(200);

        expect(second.status)
            .toBe(200);

        expect(
            first.body.duplicate,
        ).toBe(false);

        expect(
            second.body.duplicate,
        ).toBe(true);

        const invoices =
            db
                .prepare(`
                    SELECT id
                    FROM invoices
                    WHERE subscription_id = ?
                `)
                .all(subscriptionId);

        expect(invoices)
            .toHaveLength(1);

        const event =
            db
                .prepare(`
                    SELECT processing_status
                    FROM webhook_events
                    WHERE event_id = ?
                `)
                .get(
                    'evt-duplicate-001',
                ) as {
                    processing_status:
                    string;
                };

        expect(
            event.processing_status,
        ).toBe('duplicate');
    });

    it('processes a successful retry from past_due', async () => {
        db = createDatabase();

        const {
            app,
            subscriptionId,
        } =
            await createBasicSubscription();

        const failedBody =
            JSON.stringify({
                event_id:
                    'evt-retry-failed',
                event_type:
                    'payment.failed',
                subscription_id:
                    subscriptionId,
            });

        await request(app)
            .post(
                '/webhooks/payment-provider',
            )
            .set(
                'X-Webhook-Signature',
                `sha256=${sign(failedBody)}`,
            )
            .send(failedBody);

        const retryBody =
            JSON.stringify({
                event_id:
                    'evt-retry-success',
                event_type:
                    'payment.succeeded',
                subscription_id:
                    subscriptionId,
            });

        const response =
            await request(app)
                .post(
                    '/webhooks/payment-provider',
                )
                .set(
                    'X-Webhook-Signature',
                    `sha256=${sign(retryBody)}`,
                )
                .send(retryBody);

        expect(response.status)
            .toBe(200);

        expect(response.body.status)
            .toBe('active');
    });

    it('rejects an invalid transition and records the rejected attempt', async () => {
        db = createDatabase();

        const {
            app,
            subscriptionId,
        } = await createBasicSubscription();

        const firstBody = JSON.stringify({
            event_id: 'evt-invalid-transition-first',
            event_type: 'payment.succeeded',
            subscription_id: subscriptionId,
        });

        await request(app)
            .post('/webhooks/payment-provider')
            .set('X-Webhook-Signature', `sha256=${sign(firstBody)}`)
            .send(firstBody);

        const rejectedBody = JSON.stringify({
            event_id: 'evt-invalid-transition-rejected',
            event_type: 'payment.succeeded',
            subscription_id: subscriptionId,
        });

        const response = await request(app)
            .post('/webhooks/payment-provider')
            .set('X-Webhook-Signature', `sha256=${sign(rejectedBody)}`)
            .send(rejectedBody);

        expect(response.status).toBe(409);

        const audit = db.prepare(`
            SELECT old_state, new_state, event_type
            FROM audit_log
            WHERE subscription_id = ?
            ORDER BY id DESC
            LIMIT 1
        `).get(subscriptionId) as {
            old_state: string;
            new_state: string;
            event_type: string;
        };

        expect(audit).toEqual({
            old_state: 'active',
            new_state: 'active',
            event_type: 'payment.succeeded.rejected',
        });
    });
});