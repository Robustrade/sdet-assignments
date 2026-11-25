
import { describe, it, expect } from 'vitest';
import { WebhookSignature } from '../../src/webhooks/WebhookSignature.js';

describe('WebhookSignature', () => {
  const secret = 'test_webhook_secret';
  const rawBody = JSON.stringify({
    event_id: 'evt_001',
    event_type: 'payment.succeeded',
    created_at: '2026-11-25T10:00:00.000Z',
    data: {
      invoice_id: 'inv_001',
      subscription_id: 'sub_001',
      provider_reference: 'pay_001'
    }
  });

  it('should generate a valid SHA-256 HMAC signature', () => {
    const signature = WebhookSignature.generate(rawBody, secret);

    expect(signature).toBeDefined();
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should verify a valid signature', () => {
    const signature = WebhookSignature.generate(rawBody, secret);

    const result = WebhookSignature.verify(
      rawBody,
      signature,
      secret
    );

    expect(result).toBe(true);
  });

  it('should verify a signature with sha256 prefix', () => {
    const signature = WebhookSignature.generate(rawBody, secret);

    const result = WebhookSignature.verify(
      rawBody,
      `sha256=${signature}`,
      secret
    );

    expect(result).toBe(true);
  });

  it('should reject an invalid signature', () => {
    const result = WebhookSignature.verify(
      rawBody,
      'invalid_signature',
      secret
    );

    expect(result).toBe(false);
  });

  it('should reject a signature generated with a different secret', () => {
    const signature = WebhookSignature.generate(
      rawBody,
      'different_secret'
    );

    const result = WebhookSignature.verify(
      rawBody,
      signature,
      secret
    );

    expect(result).toBe(false);
  });

  it('should reject a modified payload', () => {
    const signature = WebhookSignature.generate(rawBody, secret);
    const modifiedBody = rawBody.replace('evt_001', 'evt_999');

    const result = WebhookSignature.verify(
      modifiedBody,
      signature,
      secret
    );

    expect(result).toBe(false);
  });

  it('should reject an empty payload', () => {
    const result = WebhookSignature.verify(
      '',
      'some_signature',
      secret
    );

    expect(result).toBe(false);
  });

  it('should reject an empty secret', () => {
    const signature = WebhookSignature.generate(rawBody, secret);

    const result = WebhookSignature.verify(
      rawBody,
      signature,
      ''
    );

    expect(result).toBe(false);
  });
});
