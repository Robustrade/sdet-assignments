import express, { type NextFunction, type Request, type Response } from 'express';
import type { BillingService } from '../service/BillingService';
import { ServiceError } from '../service/errors';
import { SIGNATURE_HEADER } from '../payments/signature';
import { serializeSubscription } from './serializers';

/**
 * HTTP transport for the billing service. It is intentionally thin: it maps
 * requests onto service calls, serializes results, and translates domain errors
 * into status codes. No business logic lives here.
 */
export function createApp(service: BillingService): express.Express {
  const app = express();

  // Webhook route is registered first with a raw body parser so the exact bytes
  // are available for signature verification (JSON re-serialization would change
  // them and break the HMAC).
  app.post(
    '/webhooks/payment-provider',
    express.raw({ type: '*/*' }),
    asyncHandler(async (req, res) => {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      const signature = req.header(SIGNATURE_HEADER) ?? undefined;
      const result = await service.processWebhook(rawBody, signature);
      res.status(200).json({
        status: result.outcome,
        subscription_status: result.subscriptionStatus ?? null,
        reason: result.reason,
      });
    }),
  );

  app.use(express.json());

  app.post(
    '/subscriptions',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const subscription = await service.createSubscription({
        customerId: body.customer_id,
        plan: body.plan,
        paymentMethodId: body.payment_method_id,
      });
      res.status(201).json(serializeSubscription(subscription));
    }),
  );

  app.get(
    '/subscriptions/:id',
    asyncHandler(async (req, res) => {
      const subscription = service.getSubscription(req.params.id);
      res.status(200).json(serializeSubscription(subscription));
    }),
  );

  app.post(
    '/subscriptions/:id/cancel',
    asyncHandler(async (req, res) => {
      const subscription = service.cancelSubscription(req.params.id);
      res.status(200).json(serializeSubscription(subscription));
    }),
  );

  // Centralized error translation.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ServiceError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    res.status(500).json({ error: { code: 'internal_error', message: 'unexpected error' } });
  });

  return app;
}

/** Wraps async route handlers so rejected promises reach the error middleware. */
function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
