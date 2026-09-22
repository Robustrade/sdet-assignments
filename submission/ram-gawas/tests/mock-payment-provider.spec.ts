import { describe, expect, it } from 'vitest';
import { MockPaymentProvider } from './mocks/mock-payment-provider';

describe('MockPaymentProvider', () => {
  it('returns success and records charge arguments', async () => {
    const provider = new MockPaymentProvider();

    provider.respondWithSuccess('txn_123');

    const result = await provider.charge({
      customerId: 'cust_001',
      paymentMethodId: 'pm_001',
      amount: 4900,
      reference: 'sub_001',
    });

    expect(result).toEqual({
      status: 'success',
      transactionId: 'txn_123',
    });

    expect(provider.calls).toHaveLength(1);

    expect(provider.calls[0]).toEqual({
      customerId: 'cust_001',
      paymentMethodId: 'pm_001',
      amount: 4900,
      reference: 'sub_001',
    });
  });

  it('can simulate payment decline', async () => {
    const provider = new MockPaymentProvider();

    provider.respondWithDecline();

    const result = await provider.charge({
      customerId: 'cust_001',
      paymentMethodId: 'pm_001',
      amount: 4900,
      reference: 'sub_001',
    });

    expect(result.status).toBe('declined');
  });

  it('can simulate payment timeout', async () => {
    const provider = new MockPaymentProvider();

    provider.respondWithTimeout();

    await expect(
      provider.charge({
        customerId: 'cust_001',
        paymentMethodId: 'pm_001',
        amount: 4900,
        reference: 'sub_001',
      }),
    ).rejects.toThrow('Payment provider timeout');
  });
});