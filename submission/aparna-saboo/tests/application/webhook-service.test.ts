import { MockPaymentProvider } from '../../src/infrastructure/payment/mock-payment-provider';
import { WebhookService } from '../../src/application/services/webhook-service';
import type { WebhookEventType } from '../../src/domain/models/webhook-event';
import type { CurrencyCode } from '../../src/domain/models/subscription';

describe('WebhookService', () => {
  const provider = new MockPaymentProvider();
  const service = new WebhookService();

  const buildPayload = (overrides: Partial<Record<string, unknown>> = {}) => ({
    event_id: 'evt_001',
    type: 'payment.succeeded' as WebhookEventType,
    subscription_id: 'sub_001',
    invoice_id: 'inv_001',
    amount: 4900,
    currency: 'USD' as CurrencyCode,
    ...overrides,
  });

  it('accepts a valid signature', () => {
    const payload = buildPayload();
    const signature = provider.signWebhookPayload(payload);

    const event = service.processWebhook(payload, signature);

    expect(event.eventId).toBe('evt_001');
    expect(event.type).toBe('payment.succeeded');
  });

  it('rejects an invalid signature', () => {
    const payload = buildPayload();

    expect(() => service.processWebhook(payload, 'sha256=invalid')).toThrow('Invalid signature');
  });

  it('rejects a modified payload even with the original signature', () => {
    const payload = buildPayload();
    const signature = provider.signWebhookPayload(payload);

    expect(() => service.processWebhook({ ...payload, event_id: 'evt_999' }, signature)).toThrow('Invalid signature');
  });

  it('rejects a missing signature', () => {
    const payload = buildPayload();

    expect(() => service.processWebhook(payload, '')).toThrow('Missing signature');
  });

  it('rejects a payload missing event_id', () => {
    const payload = buildPayload({ event_id: undefined });

    expect(() => service.processWebhook(payload, provider.signWebhookPayload(buildPayload()))).toThrow('event_id');
  });

  it('rejects a payload missing subscription_id', () => {
    const payload = buildPayload({ subscription_id: undefined });

    expect(() => service.processWebhook(payload, provider.signWebhookPayload(buildPayload()))).toThrow('subscription_id');
  });

  it('rejects a payload missing invoice_id', () => {
    const payload = buildPayload({ invoice_id: undefined });

    expect(() => service.processWebhook(payload, provider.signWebhookPayload(buildPayload()))).toThrow('invoice_id');
  });

  it('rejects an invalid event type', () => {
    const payload = buildPayload({ type: 'payment.cancelled' as never });

    expect(() => service.processWebhook(payload, provider.signWebhookPayload(buildPayload()))).toThrow('type');
  });

  it('rejects an invalid currency', () => {
    const payload = buildPayload({ currency: 'CAD' as never });

    expect(() => service.processWebhook(payload, provider.signWebhookPayload(buildPayload()))).toThrow('currency');
  });

  it('rejects an invalid amount', () => {
    const payload = buildPayload({ amount: Number.NaN });

    expect(() => service.processWebhook(payload, provider.signWebhookPayload(buildPayload()))).toThrow('amount');
  });

  it('rejects an empty event_id', () => {
    const payload = buildPayload({ event_id: '' });

    expect(() => service.processWebhook(payload, provider.signWebhookPayload(buildPayload()))).toThrow('event_id');
  });

  it('rejects a non-object payload', () => {
    expect(() => service.processWebhook('not-an-object', 'sha256=abc')).toThrow('Payload must be an object');
  });

  it('normalizes a valid payment.succeeded payload', () => {
    const payload = buildPayload();
    const event = service.processWebhook(payload, provider.signWebhookPayload(payload));

    expect(event).toMatchObject({
      eventId: 'evt_001',
      subscriptionId: 'sub_001',
      invoiceId: 'inv_001',
      type: 'payment.succeeded',
    });
    expect(event.processedAt).toBeTruthy();
  });

  it('normalizes a valid payment.failed payload', () => {
    const payload = buildPayload({ type: 'payment.failed' });
    const event = service.processWebhook(payload, provider.signWebhookPayload(payload));

    expect(event.type).toBe('payment.failed');
    expect(event.processedAt).toBeTruthy();
  });

  it('normalizes a valid payment.refunded payload', () => {
    const payload = buildPayload({ type: 'payment.refunded' });
    const event = service.processWebhook(payload, provider.signWebhookPayload(payload));

    expect(event.type).toBe('payment.refunded');
    expect(event.processedAt).toBeTruthy();
  });
});
