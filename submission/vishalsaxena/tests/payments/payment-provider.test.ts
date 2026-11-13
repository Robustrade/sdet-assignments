
import { describe, it, expect } from 'vitest';
import { MockPaymentProvider } from '../../src/providers/MockPaymentProvider';

describe('Mock Payment Provider', () => {
  it('should process successful payments', async () => {
    const provider = new MockPaymentProvider();

    const result = await provider.charge({
      invoiceId: 'inv_001',
      amountCents: 2999,
      currency: 'USD',
      idempotencyKey: 'payment_test_001'
    });

    expect(result.success).toBe(true);
    expect(result.providerPaymentId).toBe('pay_inv_001');
    expect(provider.getCallCount()).toBe(1);
  });

  it('should simulate payment decline', async () => {
    const provider = new MockPaymentProvider();

    provider.setScenario('decline');

    const result = await provider.charge({
      invoiceId: 'inv_002',
      amountCents: 2999,
      currency: 'USD',
      idempotencyKey: 'payment_test_002'
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Payment declined');
  });

  it('should simulate provider timeout', async () => {
    const provider = new MockPaymentProvider();

    provider.setScenario('timeout');

    await expect(
      provider.charge({
        invoiceId: 'inv_003',
        amountCents: 2999,
        currency: 'USD',
        idempotencyKey: 'payment_test_003'
      })
    ).rejects.toThrow('Payment provider timeout');
  });

  it('should not charge twice for the same idempotency key', async () => {
    const provider = new MockPaymentProvider();
  
    const request = {
      invoiceId: 'inv_duplicate',
      amountCents: 4900,
      currency: 'USD',
      idempotencyKey: 'payment_duplicate_001'
    };
  
    const firstResult = await provider.charge(request);
    const secondResult = await provider.charge(request);
  
    expect(firstResult).toEqual(secondResult);
    expect(provider.getCallCount()).toBe(1);
  });

  it('should reject requests without an idempotency key', async () => {
    const provider = new MockPaymentProvider();
  
    await expect(
      provider.charge({
        invoiceId: 'inv_missing_key',
        amountCents: 4900,
        currency: 'USD',
        idempotencyKey: ''
      })
    ).rejects.toThrow('Idempotency key is required');
  
    expect(provider.getCallCount()).toBe(0);
  });

  it('should reject reuse of an idempotency key with different payment details', async () => {
    const provider = new MockPaymentProvider();
  
    await provider.charge({
      invoiceId: 'inv_001',
      amountCents: 4900,
      currency: 'USD',
      idempotencyKey: 'same_key'
    });
  
    await expect(
      provider.charge({
        invoiceId: 'inv_002',
        amountCents: 4900,
        currency: 'USD',
        idempotencyKey: 'same_key'
      })
    ).rejects.toThrow(
      'Idempotency key reused with different payment details'
    );
  
    expect(provider.getCallCount()).toBe(1);
  });
});
