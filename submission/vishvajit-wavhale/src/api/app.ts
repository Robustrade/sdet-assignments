
import express, {
  type Express,
  type Request,
  type Response
} from 'express';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { SubscriptionService } from '../services/SubscriptionService.js';
import { WebhookService } from '../services/WebhookService.js';

interface AppDependencies {
  subscriptionService: SubscriptionService;
  webhookService: WebhookService;
}

const createSubscriptionSchema = z.object({
  customerId: z.string().trim().min(1, 'Customer ID is required'),
  planId: z.string().trim().min(1, 'Plan ID is required'),
  paymentMethodId: z.string().trim().min(1, 'Payment method ID is required')
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Internal server error';
}

function getErrorStatus(error: unknown): number {
  const message = getErrorMessage(error);

  if (
    message.includes('not found') ||
    message.includes('Not found')
  ) {
    return 404;
  }

  if (
    message.includes('Invalid transition') ||
    (error instanceof Error &&
      error.name === 'InvalidSubscriptionTransitionError')
  ) {
    return 409;
  }

  if (
    message.includes('UNIQUE constraint failed') ||
    message.includes('FOREIGN KEY constraint failed')
  ) {
    return 409;
  }

  return 500;
}

/**
 * Safely extracts a subscription ID from Express route parameters.
 * Express parameter types can be string or string[].
 */
function getSubscriptionId(req: Request): string | null {
  const id = req.params.id;

  if (typeof id === 'string' && id.trim().length > 0) {
    return id;
  }

  if (
    Array.isArray(id) &&
    typeof id[0] === 'string' &&
    id[0].trim().length > 0
  ) {
    return id[0];
  }

  return null;
}

export function createApp(
  dependencies: AppDependencies
): Express {
  const app = express();

  const { subscriptionService, webhookService } = dependencies;

  // Webhook route must be registered before express.json().
  // The signature must be verified against the original raw body.
  app.post(
    '/webhooks/payment-provider',
    express.raw({
      type: 'application/json',
      limit: '1mb'
    }),
    async (req: Request, res: Response) => {
      try {
        const rawBody = Buffer.isBuffer(req.body)
          ? req.body.toString('utf8')
          : '';

        const signature = req.header('x-webhook-signature') ?? '';

        const result = await webhookService.processWebhook(
          rawBody,
          signature
        );

        if (result.status === 'invalid') {
          const statusCode =
            result.message === 'Invalid webhook signature'
              ? 401
              : 400;

          res.status(statusCode).json({
            success: false,
            data: result
          });

          return;
        }

        res.status(200).json({
          success: true,
          data: result
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          message: getErrorMessage(error)
        });
      }
    }
  );

  // JSON parsing for normal API requests.
  app.use(express.json({ limit: '1mb' }));

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: 'Subscription Billing API is running'
    });
  });

  // Create subscription
  app.post(
    '/subscriptions',
    (req: Request, res: Response) => {
      const validation = createSubscriptionSchema.safeParse(req.body);

      if (!validation.success) {
        res.status(400).json({
          success: false,
          message: 'Invalid request body',
          errors: validation.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
        });

        return;
      }

      try {
        const subscription = subscriptionService.createSubscription({
          id: randomUUID(),
          customerId: validation.data.customerId,
          planId: validation.data.planId,
          paymentMethodId: validation.data.paymentMethodId
        });

        res.status(201).json({
          success: true,
          data: subscription
        });
      } catch (error) {
        res.status(getErrorStatus(error)).json({
          success: false,
          message: getErrorMessage(error)
        });
      }
    }
  );

  // Get subscription by ID
  app.get(
    '/subscriptions/:id',
    (req: Request, res: Response) => {
      const subscriptionId = getSubscriptionId(req);

      if (!subscriptionId) {
        res.status(400).json({
          success: false,
          message: 'Invalid subscription ID'
        });

        return;
      }

      try {
        const subscription =
          subscriptionService.getSubscription(subscriptionId);

        if (!subscription) {
          res.status(404).json({
            success: false,
            message: 'Subscription not found'
          });

          return;
        }

        res.status(200).json({
          success: true,
          data: subscription
        });
      } catch (error) {
        res.status(getErrorStatus(error)).json({
          success: false,
          message: getErrorMessage(error)
        });
      }
    }
  );

  // Cancel subscription
  app.post(
    '/subscriptions/:id/cancel',
    (req: Request, res: Response) => {
      const subscriptionId = getSubscriptionId(req);

      if (!subscriptionId) {
        res.status(400).json({
          success: false,
          message: 'Invalid subscription ID'
        });

        return;
      }

      try {
        const subscription =
          subscriptionService.cancelSubscription(subscriptionId);

        res.status(200).json({
          success: true,
          data: subscription
        });
      } catch (error) {
        res.status(getErrorStatus(error)).json({
          success: false,
          message: getErrorMessage(error)
        });
      }
    }
  );

  // Handle unknown routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: 'Route not found'
    });
  });

  return app;
}
