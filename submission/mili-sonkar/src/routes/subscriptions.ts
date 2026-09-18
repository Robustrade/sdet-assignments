import { Router, type Request, type Response } from 'express';

import type { SubscriptionService } from '../application/SubscriptionService.js';

export function createSubscriptionRouter(
    subscriptionService: SubscriptionService,
): Router {
    const router = Router();

    router.post(
        '/subscriptions',
        (req: Request, res: Response) => {
            const idempotencyKey =
                req.header('Idempotency-Key');

            const correlationId =
                req.header('X-Correlation-ID') ??
                `corr-${crypto.randomUUID()}`;

            const { customerId, plan } =
                req.body ?? {};

            if (
                typeof customerId !== 'string' ||
                customerId.trim() === ''
            ) {
                return res.status(400).json({
                    error: 'customerId is required',
                });
            }

            if (
                plan !== 'basic' &&
                plan !== 'pro'
            ) {
                return res.status(400).json({
                    error: 'plan must be basic or pro',
                });
            }

            try {
                const result =
                    subscriptionService.createSubscription({
                        customerId,
                        plan,
                        idempotencyKey,
                        correlationId,
                    });

                return res.status(result.statusCode).json(
                    result.body,
                );
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Internal server error';

                if (
                    message.includes(
                        'already being processed',
                    )
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

    router.get(
        '/subscriptions/:id',
        (req: Request, res: Response) => {
            const id = String(req.params.id);

            const subscription =
                subscriptionService.getSubscription(
                    id,
                );

            if (!subscription) {
                return res.status(404).json({
                    error: 'Subscription not found',
                });
            }

            return res.status(200).json(
                subscription,
            );
        },
    );

    router.post(
        '/subscriptions/:id/cancel',
        (req: Request, res: Response) => {
            const id = String(req.params.id);

            const correlationId =
                req.header('X-Correlation-ID') ??
                `corr-${crypto.randomUUID()}`;

            try {
                const subscription =
                    subscriptionService.cancelSubscription(
                        id,
                        correlationId,
                    );

                return res.status(200).json(
                    subscription,
                );
            } catch (error) {
                const message =
                    error instanceof Error
                        ? error.message
                        : 'Internal server error';

                if (
                    message.includes('not found')
                ) {
                    return res.status(404).json({
                        error: message,
                    });
                }

                if (
                    message.includes(
                        'Invalid transition',
                    )
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