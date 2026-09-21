import {
    Router,
    type Request,
    type Response,
} from 'express';

import {
    createHmac,
    timingSafeEqual,
} from 'node:crypto';

import type {
    WebhookEventType,
    WebhookPayload,
    WebhookProcessor,
} from '../application/WebhookProcessor.js';

interface RawBodyRequest extends Request {
    rawBody?: Buffer;
}

export function createWebhookRouter(
    webhookProcessor: WebhookProcessor,
    webhookSecret: string,
): Router {
    const router = Router();

    router.post(
        '/webhooks/payment-provider',
        (req: Request, res: Response) => {
            const request = req as RawBodyRequest;

            const signature =
                req.header('X-Webhook-Signature');

            if (!signature) {
                return res.status(401).json({
                    error: 'Missing webhook signature',
                });
            }

            if (!webhookSecret) {
                return res.status(500).json({
                    error:
                        'Webhook secret is not configured',
                });
            }

            if (
                !verifyWebhookSignature(
                    request.rawBody,
                    signature,
                    webhookSecret,
                )
            ) {
                return res.status(401).json({
                    error: 'Invalid webhook signature',
                });
            }

            let body: Record<string, unknown> | undefined;

            if (typeof req.body === 'string') {
                try {
                    body = JSON.parse(req.body) as Record<string, unknown>;
                } catch {
                    return res.status(400).json({
                        error: 'Webhook body must be valid JSON',
                    });
                }
            } else {
                body = req.body as Record<string, unknown> | undefined;
            }

            const eventId =
                body?.event_id;

            const eventType =
                body?.event_type;

            const subscriptionId =
                body?.subscription_id;

            const correlationId =
                req.header('X-Correlation-ID') ??
                `corr-${crypto.randomUUID()}`;

            if (
                typeof eventId !== 'string' ||
                typeof eventType !== 'string' ||
                typeof subscriptionId !== 'string'
            ) {
                return res.status(400).json({
                    error:
                        'event_id, event_type and subscription_id are required',
                });
            }

            if (!isValidEventType(eventType)) {
                return res.status(400).json({
                    error:
                        'Unsupported webhook event type',
                });
            }

            const webhook: WebhookPayload = {
                eventId,
                eventType,
                subscriptionId,
                correlationId,
            };

            try {
                const result =
                    webhookProcessor.process(
                        webhook,
                    );

                return res.status(200).json(result);
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Internal server error';

                if (
                    message.includes('not found') ||
                    message.includes('Invalid transition')
                ) {
                    return res.status(409).json({
                        error: message,
                    });
                }

                return res.status(500).json({
                    error: message,
                });
            }
        },
    );

    return router;
}

function verifyWebhookSignature(
    rawBody: Buffer | undefined,
    signature: string,
    secret: string,
): boolean {
    if (!rawBody) {
        return false;
    }

    const suppliedSignature =
        signature.startsWith('sha256=')
            ? signature.slice(7)
            : signature;

    const expectedSignature =
        createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');

    if (
        suppliedSignature.length !==
        expectedSignature.length
    ) {
        return false;
    }

    try {
        return timingSafeEqual(
            Buffer.from(
                suppliedSignature,
                'utf8',
            ),
            Buffer.from(
                expectedSignature,
                'utf8',
            ),
        );
    } catch {
        return false;
    }
}

function isValidEventType(
    value: string,
): value is WebhookEventType {
    return (
        value === 'payment.succeeded' ||
        value === 'payment.failed' ||
        value === 'payment.refunded'
    );
}