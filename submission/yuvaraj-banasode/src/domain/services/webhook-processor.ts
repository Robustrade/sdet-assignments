/**
 * Webhook Processor
 * 
 * Handles incoming webhook events with signature verification and idempotency.
 * Ensures duplicate events don't create duplicate side effects.
 */

import { v4 as uuid } from 'uuid';
import { WebhookPayload, WebhookEvent } from '../../types';
import { InMemoryDatabase } from '../../infrastructure/in-memory-database';
import { SubscriptionService } from './subscription-service';
import crypto from 'crypto';

export class WebhookProcessor {
  private readonly webhookSecret = 'test_secret'; // In production, load from env

  constructor(
    private db: InMemoryDatabase,
    private subscriptionService: SubscriptionService
  ) {}

  /**
   * Verify webhook signature
   * 
   * Expected header: X-Provider-Signature
   * Value: HMAC-SHA256 hex of raw body
   */
  verifySignature(rawBody: string, signature: string): boolean {
    const computed = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expected = Buffer.from(computed);
    const actual = Buffer.from(signature);

    if (expected.length !== actual.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  /**
   * Process an incoming webhook with idempotency
   * 
   * 1. Verify signature
   * 2. Check if event_id was already processed
   * 3. If not, call SubscriptionService to apply state change
   * 4. Record event as processed
   */
  async processWebhook(
    payload: WebhookPayload,
    signature: string
  ): Promise<{ processed: boolean; eventId: string }> {
    // Verify signature
    const rawBody = JSON.stringify(payload);
    if (!this.verifySignature(rawBody, signature)) {
      throw new Error('Invalid webhook signature');
    }

    // Check idempotency: have we seen this event_id before?
    const existing = this.db.getWebhookEvent(payload.event_id);
    if (existing?.processed) {
      // Already processed; return success without re-processing
      return { processed: false, eventId: payload.event_id };
    }

    // First time seeing this event; process it
    const eventType = payload.type;
    await this.subscriptionService.handlePaymentWebhook(
      payload.subscription_id,
      eventType
    );

    // Record webhook event
    const webhookEvent: WebhookEvent = {
      id: `evt_${uuid()}`,
      eventId: payload.event_id,
      type: payload.type,
      subscriptionId: payload.subscription_id,
      payload: payload as unknown as Record<string, unknown>,
      processed: true,
      processedAt: new Date(),
      createdAt: new Date(),
    };
    this.db.saveWebhookEvent(webhookEvent);

    return { processed: true, eventId: payload.event_id };
  }

  getWebhookSecret(): string {
    return this.webhookSecret;
  }
}
