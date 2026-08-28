import { createHmac } from 'node:crypto';
import type { PaymentProvider, PaymentOutcome, ChargeCustomerArgs, ChargeCustomerResult } from '../../application/ports/payment-provider';
import type { CurrencyCode } from '../../domain/models/subscription';
import type { WebhookEventType } from '../../domain/models/webhook-event';

const WEBHOOK_SECRET = 'test-webhook-secret';

export interface WebhookPayloadForProvider {
  event_id: string;
  type: WebhookEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: CurrencyCode;
}

export class MockPaymentProvider implements PaymentProvider {
  private outcome: PaymentOutcome = 'success';
  private readonly calls: ChargeCustomerArgs[] = [];
  private providerReferenceIndex = 1;

  configureOutcome(outcome: PaymentOutcome): void {
    this.outcome = outcome;
  }

  get callCount(): number {
    return this.calls.length;
  }

  getCalls(): readonly ChargeCustomerArgs[] {
    return [...this.calls];
  }

  createWebhookPayload(overrides: Partial<WebhookPayloadForProvider> = {}): WebhookPayloadForProvider {
    return {
      event_id: 'evt_001',
      type: 'payment.succeeded',
      subscription_id: 'sub_001',
      invoice_id: 'inv_001',
      amount: 4900,
      currency: 'USD',
      ...overrides,
    };
  }

  signWebhookPayload(payload: WebhookPayloadForProvider): string {
    const serialized = JSON.stringify(payload);
    const hmac = createHmac('sha256', WEBHOOK_SECRET);
    hmac.update(serialized);
    return `sha256=${hmac.digest('hex')}`;
  }

  reset(): void {
    this.calls.length = 0;
    this.outcome = 'success';
    this.providerReferenceIndex = 1;
  }

  async chargeCustomer(args: ChargeCustomerArgs): Promise<ChargeCustomerResult> {
    this.calls.push({ ...args });

    switch (this.outcome) {
      case 'success':
        return {
          success: true,
          outcome: 'success',
          providerReference: `mock-ref-${this.providerReferenceIndex++}`,
        };
      case 'decline':
        return {
          success: false,
          outcome: 'decline',
          error: `Payment declined for customer ${args.customerId}`,
        };
      case 'timeout':
        return {
          success: false,
          outcome: 'timeout',
          error: `Payment timeout for customer ${args.customerId}`,
        };
      default:
        return {
          success: false,
          outcome: 'decline',
          error: 'Unknown payment outcome',
        };
    }
  }
}
