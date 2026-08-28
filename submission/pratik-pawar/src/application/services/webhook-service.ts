import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CurrencyCode } from '../../domain/models/subscription';
import type { WebhookEvent, WebhookEventType } from '../../domain/models/webhook-event';

const WEBHOOK_SECRET = 'test-webhook-secret';
const VALID_WEBHOOK_TYPES: WebhookEventType[] = ['payment.succeeded', 'payment.failed', 'payment.refunded'];
const VALID_CURRENCIES: CurrencyCode[] = ['USD', 'EUR', 'GBP'];

export interface WebhookPayload {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: CurrencyCode;
}

export class WebhookService {
  processWebhook(rawPayload: unknown, signature: string): WebhookEvent {
    if (typeof rawPayload !== 'object' || rawPayload === null || Array.isArray(rawPayload)) {
      throw new Error('Payload must be an object');
    }

    if (!signature || signature.trim().length === 0) {
      throw new Error('Missing signature');
    }

    const payload = rawPayload as Record<string, unknown>;

    const eventId = payload.event_id;
    const type = payload.type;
    const subscriptionId = payload.subscription_id;
    const invoiceId = payload.invoice_id;
    const amount = payload.amount;
    const currency = payload.currency;

    if (!this.isNonEmptyString(eventId)) {
      throw new Error('event_id is required');
    }
    if (!this.isNonEmptyString(subscriptionId)) {
      throw new Error('subscription_id is required');
    }
    if (!this.isNonEmptyString(invoiceId)) {
      throw new Error('invoice_id is required');
    }
    if (!this.isValidEventType(type)) {
      throw new Error('type is invalid');
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new Error('amount must be a finite number');
    }
    if (!this.isValidCurrency(currency)) {
      throw new Error('currency is invalid');
    }

    const expectedSignature = this.generateSignature(rawPayload);
    const suppliedSignature = signature.startsWith('sha256=') ? signature : `sha256=${signature}`;
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const suppliedBuffer = Buffer.from(suppliedSignature, 'utf8');

    if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      throw new Error('Invalid signature');
    }

    return {
      eventId,
      subscriptionId,
      invoiceId,
      type,
      processedAt: new Date().toISOString(),
    };
  }

  private generateSignature(payload: unknown): string {
    const serialized = JSON.stringify(payload);
    const hmac = createHmac('sha256', WEBHOOK_SECRET);
    hmac.update(serialized);
    return `sha256=${hmac.digest('hex')}`;
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private isValidEventType(value: unknown): value is WebhookEventType {
    return typeof value === 'string' && VALID_WEBHOOK_TYPES.includes(value as WebhookEventType);
  }

  private isValidCurrency(value: unknown): value is CurrencyCode {
    return typeof value === 'string' && VALID_CURRENCIES.includes(value as CurrencyCode);
  }
}
