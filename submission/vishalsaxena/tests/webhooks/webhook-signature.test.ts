
import { describe, it, expect } from 'vitest';
import {
  generateWebhookSignature,
  verifyWebhookSignature
} from '../../src/utils/webhookSignature';

describe('Webhook Signature', () => {
  const secret = 'test_webhook_secret';
  const payload = JSON.stringify({
    id: 'evt_001',
    type: 'payment.succeeded'
  });

  it('should generate a valid HMAC signature', () => {
    const signature = generateWebhookSignature(payload, secret);

    expect(signature).toHaveLength(64);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should verify a valid signature', () => {
    const signature = generateWebhookSignature(payload, secret);

    expect(
      verifyWebhookSignature(payload, signature, secret)
    ).toBe(true);
  });

  it('should reject an invalid signature', () => {
    expect(
      verifyWebhookSignature(payload, 'invalid-signature', secret)
    ).toBe(false);
  });

  it('should reject a signature generated with another secret', () => {
    const signature = generateWebhookSignature(payload, 'wrong_secret');

    expect(
      verifyWebhookSignature(payload, signature, secret)
    ).toBe(false);
  });

  it('should reject a modified payload', () => {
    const signature = generateWebhookSignature(payload, secret);
    const modifiedPayload = JSON.stringify({
      id: 'evt_001',
      type: 'payment.failed'
    });

    expect(
      verifyWebhookSignature(modifiedPayload, signature, secret)
    ).toBe(false);
  });

  it('should reject an empty signature', () => {
    expect(
      verifyWebhookSignature(payload, '', secret)
    ).toBe(false);
  });
});
