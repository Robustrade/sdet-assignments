import express, { type Express, type Request } from 'express';

import { createSubscriptionRouter } from '../routes/subscriptions.js';
import { createWebhookRouter } from '../routes/webhooks.js';
import { SubscriptionService } from '../application/SubscriptionService.js';
import { WebhookProcessor } from '../application/WebhookProcessor.js';

import type { DatabaseSync } from 'node:sqlite';
import type { PaymentProvider } from '../infrastructure/payment-provider/PaymentProvider.js';
import { MockPaymentProvider } from '../infrastructure/payment-provider/MockPaymentProvider.js';

export interface CreateAppOptions {
    db: DatabaseSync;
    paymentProvider?: PaymentProvider;
    webhookSecret?: string;
}

function createDefaultPaymentProvider(): PaymentProvider {
    return new MockPaymentProvider();
}

export function createApp({
    db,
    paymentProvider,
    webhookSecret = process.env.WEBHOOK_SECRET ?? '',
}: CreateAppOptions): Express {
    const app = express();

    app.use(
        express.json({
            verify: (req, _res, buffer) => {
                (req as Request).rawBody = Buffer.from(buffer);
            },
        }),
    );

    app.use(
        express.text({
            type: '*/*',
            verify: (req, _res, buffer) => {
                (req as Request).rawBody = Buffer.from(buffer);
            },
        }),
    );

    const subscriptionService =
        new SubscriptionService(
            db,
            paymentProvider ?? createDefaultPaymentProvider(),
        );

    const webhookProcessor =
        new WebhookProcessor(db);

    app.use(
        createSubscriptionRouter(
            subscriptionService,
        ),
    );

    app.use(
        createWebhookRouter(
            webhookProcessor,
            webhookSecret,
        ),
    );

    return app;
}