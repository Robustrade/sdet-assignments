
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockPaymentProvider,
  type ChargeRequest,
} from '../src/payment-provider.js';

describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider;
  let request: ChargeRequest;

  beforeEach(() => {
    provider = new MockPaymentProvider();

    request = {
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amount: 4900,
      currency: 'USD',
      idempotencyKey: 'sub_001-invoice_001',
    };
  });

  it('returns success and records the charge request', async () => {
    const result = await provider.charge(request);

    expect(result.success).toBe(true);
    expect(result.reference).toBe('pay_test_1');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toEqual(request);
  });

  it('simulates a declined payment', async () => {
    provider.setOutcome('decline');

    const result = await provider.charge(request);

    expect(result.success).toBe(false);
    expect(result.error).toBe('declined');
    expect(provider.calls).toHaveLength(1);
  });

  it('simulates a payment timeout', async () => {
    provider.setOutcome('timeout');

    const result = await provider.charge(request);

    expect(result.success).toBe(false);
    expect(result.error).toBe('timeout');
    expect(provider.calls).toHaveLength(1);
  });

  it('resets calls and outcome', async () => {
    provider.setOutcome('decline');
    await provider.charge(request);

    provider.reset();

    expect(provider.calls).toHaveLength(0);

    const result = await provider.charge(request);
    expect(result.success).toBe(true);
  });
});
