/**
 * Factory Pattern - Webhook Payload Factory
 *
 * Creates webhook payloads for testing, including signature generation.
 */

import { WebhookPayload, WebhookEventType } from '../../src/domain/subscription/types';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto';

export const WEBHOOK_SECRET = 'test_webhook_secret_key';

export class WebhookPayloadFactory {
  /**
   * Create a payment.succeeded webhook payload
   */
  static createPaymentSucceeded(
    subscriptionId: string,
    invoiceId: string,
    amount: number = 4900
  ): WebhookPayload {
    return {
      event_id: `evt_${randomUUID()}`,
      type: 'payment.succeeded',
      subscription_id: subscriptionId,
      invoice_id: invoiceId,
      amount,
      currency: 'USD',
    };
  }

  /**
   * Create a payment.failed webhook payload
   */
  static createPaymentFailed(
    subscriptionId: string,
    invoiceId: string,
    amount: number = 4900
  ): WebhookPayload {
    return {
      event_id: `evt_${randomUUID()}`,
      type: 'payment.failed',
      subscription_id: subscriptionId,
      invoice_id: invoiceId,
      amount,
      currency: 'USD',
    };
  }

  /**
   * Create a payment.refunded webhook payload
   */
  static createPaymentRefunded(
    subscriptionId: string,
    invoiceId: string,
    amount: number = 4900
  ): WebhookPayload {
    return {
      event_id: `evt_${randomUUID()}`,
      type: 'payment.refunded',
      subscription_id: subscriptionId,
      invoice_id: invoiceId,
      amount,
      currency: 'USD',
    };
  }

  /**
   * Create a custom webhook payload
   */
  static createCustom(
    eventId: string,
    type: WebhookEventType,
    subscriptionId: string,
    invoiceId: string
  ): WebhookPayload {
    return {
      event_id: eventId,
      type,
      subscription_id: subscriptionId,
      invoice_id: invoiceId,
      amount: 4900,
      currency: 'USD',
    };
  }

  /**
   * Generate HMAC signature for webhook payload
   */
  static signPayload(payload: WebhookPayload | any, secret: string = WEBHOOK_SECRET): string {
    const payloadString = JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
  }

  /**
   * Generate an invalid signature (for security testing)
   */
  static generateInvalidSignature(): string {
    return 'invalid_signature_' + randomUUID();
  }
}
