import express, { Router } from 'express';
import { BillingError } from '../errors';
import type { WebhookService } from '../services/WebhookService';
import { parsePaymentWebhook } from './webhookPayload';
import { isValidSignature } from './webhookSignature';

/**
 * Must be mounted BEFORE `express.json()`: the signature is computed over the exact bytes the provider
 * sent, so this route reads the body raw and parses it only after the signature has been verified.
 * Order of checks: signature (401), then payload shape (400), then business handling.
 */
export function webhookRoutes(service: WebhookService, secret: string | undefined): Router {
  const router = Router();

  router.post('/webhooks/payment-provider', express.raw({ type: () => true }), async (req, res) => {
    if (!secret) {
      // Misconfiguration, not a client error: refuse to guess (fails closed).
      throw new Error('Webhook secret is not configured');
    }
    // An empty body is not parsed by body-parser and leaves req.body undefined.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!isValidSignature(rawBody, req.header('x-provider-signature'), secret)) {
      throw new BillingError('invalid_signature', 'Missing or invalid X-Provider-Signature');
    }

    const status = await service.process(parsePaymentWebhook(rawBody));
    // 200 for every accepted delivery, including ignored ones, so the provider stops retrying.
    res.status(200).json({ status });
  });

  return router;
}
