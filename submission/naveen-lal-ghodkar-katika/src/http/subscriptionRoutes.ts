import { Router } from 'express';
import { BillingError } from '../errors';
import type { SubscriptionRecord } from '../domain/Subscription';
import type { CreateSubscriptionInput, SubscriptionService } from '../services/SubscriptionService';

const REQUIRED_FIELDS = ['customer_id', 'plan', 'payment_method_id'] as const;

/** Shape validation only (presence and type). Business rules live in the service. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/** The header is optional; when present it must be a non-blank string of sane length. */
function parseIdempotencyKey(header: string | string[] | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const value = Array.isArray(header) ? '' : header.trim();
  if (value === '' || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new BillingError(
      'validation_error',
      `Idempotency-Key header must be a non-blank string of at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }
  return value;
}

function parseCreateRequest(body: unknown, idempotencyHeader: string | string[] | undefined): CreateSubscriptionInput {
  const source = typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {};
  const record = source as Record<string, unknown>;

  const invalid = REQUIRED_FIELDS.filter(
    (field) => typeof record[field] !== 'string' || (record[field] as string).trim() === '',
  );
  if (invalid.length > 0) {
    throw new BillingError(
      'validation_error',
      `Missing or invalid field(s): ${invalid.join(', ')} (non-empty strings required)`,
    );
  }
  return {
    customerId: record.customer_id as string,
    plan: record.plan as string,
    paymentMethodId: record.payment_method_id as string,
    idempotencyKey: parseIdempotencyKey(idempotencyHeader),
  };
}

function toResponse(subscription: SubscriptionRecord) {
  return {
    id: subscription.id,
    customer_id: subscription.customerId,
    plan: subscription.plan,
    status: subscription.status,
    price: subscription.priceCents,
    currency: subscription.currency,
    trial_ends_at: subscription.trialEndsAt,
    created_at: subscription.createdAt,
  };
}

export function subscriptionRoutes(service: SubscriptionService): Router {
  const router = Router();

  router.post('/subscriptions', async (req, res) => {
    const { subscription, replayed } = await service.create(
      parseCreateRequest(req.body, req.headers['idempotency-key']),
    );
    // 201 for a newly created subscription, 200 when an Idempotency-Key replay returns the existing one.
    res.status(replayed ? 200 : 201).json(toResponse(subscription));
  });

  router.get('/subscriptions/:id', async (req, res) => {
    res.status(200).json(toResponse(await service.get(req.params.id)));
  });

  router.post('/subscriptions/:id/cancel', async (req, res) => {
    res.status(200).json(toResponse(await service.cancel(req.params.id)));
  });

  return router;
}
