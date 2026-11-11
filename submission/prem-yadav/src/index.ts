import { SubscriptionService } from './services/SubscriptionService';
import express, { Request, Response } from 'express';
import { PaymentWebhookHandler } from './services/PaymentWebhookHandler';
import { WebhookSignatureVerifier } from './utils/WebhookSignature';

export const appName: string = 'Subscription Billing Service';

export function createApp(
    webhookHandler: PaymentWebhookHandler,
    signatureVerifier: WebhookSignatureVerifier,
    subscriptionService: SubscriptionService
) {
    const app = express();

    app.post(
        '/webhooks/payment-provider',
        express.raw({ type: 'application/json' }),
        (req: Request, res: Response) => {
            try {
                const rawBody = req.body;

                if (!Buffer.isBuffer(rawBody)) {
                    return res.status(400).json({
                        error: 'Invalid request body'
                    });
                }

                const signature = req.headers['x-provider-signature'];

                if (
                    typeof signature !== 'string' ||
                    !signatureVerifier.verify(rawBody, signature)
                ) {
                    return res.status(401).json({
                        error: 'Invalid webhook signature'
                    });
                }

                let event;

                try {
                    event = JSON.parse(rawBody.toString('utf8'));
                } catch {
                    return res.status(400).json({
                        error: 'Malformed JSON payload'
                    });
                }

                const result = webhookHandler.handle(event);

                return res.status(200).json({
                    success: true,
                    processed: result.processed
                });
            } catch (error) {
                if (
                    error instanceof Error &&
                    (
                        error.message === 'Invalid webhook event payload' ||
                        error.message.startsWith('Subscription not found:')
                    )
                ) {
                    return res.status(400).json({
                        error: error.message
                    });
                }

                return res.status(500).json({
                    error: 'Internal server error'
                });
            }
        }
    );

    // Parse JSON bodies for subscription APIs.
    // Keep this after the raw webhook route so webhook signatures
    // are verified against the original request body.
    app.use(express.json());

    // Create subscription
    app.post('/subscriptions', async (req: Request, res: Response) => {
        try {
            const { customerId, plan, paymentMethodId } = req.body;

            if (!customerId || !plan || !paymentMethodId) {
                return res.status(400).json({
                    error: 'customerId, plan and paymentMethodId are required'
                });
            }

            if (!['basic', 'pro'].includes(plan)) {
                return res.status(400).json({
                    error: 'Invalid subscription plan'
                });
            }

            const subscription = await subscriptionService.createSubscription({
                customerId,
                plan,
                paymentMethodId
            });

            return res.status(201).json({
                success: true,
                subscription
            });
        } catch {
            return res.status(500).json({
                error: 'Internal server error'
            });
        }
    });

    // Get subscription
    app.get('/subscriptions/:id', (req: Request, res: Response) => {
        try {
            const subscription = subscriptionService.getSubscription(
                String(req.params.id)
            );

            return res.status(200).json({
                success: true,
                subscription
            });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.startsWith('Subscription not found:')
            ) {
                return res.status(404).json({
                    error: 'Subscription not found'
                });
            }

            return res.status(500).json({
                error: 'Internal server error'
            });
        }
    });

    // Cancel subscription
    app.post(
        '/subscriptions/:id/cancel',
        (req: Request, res: Response) => {
            try {
                const subscription = subscriptionService.cancelSubscription(
                    String(req.params.id)
                );

                return res.status(200).json({
                    success: true,
                    subscription
                });
            } catch (error) {
                if (
                    error instanceof Error &&
                    error.message.startsWith('Subscription not found:')
                ) {
                    return res.status(404).json({
                        error: 'Subscription not found'
                    });
                }

                return res.status(400).json({
                    error: error instanceof Error
                        ? error.message
                        : 'Unable to cancel subscription'
                });
            }
        }
    );

    return app;
}
