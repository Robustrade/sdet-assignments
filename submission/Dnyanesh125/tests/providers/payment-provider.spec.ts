import { test, expect } from '@playwright/test';
import { FakePaymentProvider } from '../../src/providers/fake-payment-provider';

test.describe('Fake Payment Provider', () => {
  test('should return success and record the payment request', async () => {
    const provider = new FakePaymentProvider();

    const result = await provider.charge({
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amountCents: 4900,
      currency: 'USD',
      referenceId: 'inv_001',
    });

    expect(result.outcome).toBe('success');
    expect(result.providerPaymentId).toBeDefined();

    expect(provider.getCallCount()).toBe(1);

    expect(provider.getCalls()[0]?.request).toEqual({
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amountCents: 4900,
      currency: 'USD',
      referenceId: 'inv_001',
    });
  });

  test('should simulate a declined payment', async () => {
    const provider = new FakePaymentProvider();

    provider.setOutcome('declined');

    const result = await provider.charge({
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa_4242',
      amountCents: 4900,
      currency: 'USD',
      referenceId: 'inv_001',
    });

    expect(result.outcome).toBe('declined');
    expect(result.message).toBe('Payment declined');
    expect(provider.getCallCount()).toBe(1);
  });

  test('should simulate a provider timeout', async () => {
    const provider = new FakePaymentProvider();

    provider.setOutcome('timeout');

    await expect(
      provider.charge({
        customerId: 'cust_001',
        paymentMethodId: 'pm_test_visa_4242',
        amountCents: 4900,
        currency: 'USD',
        referenceId: 'inv_001',
      }),
    ).rejects.toThrow('Payment provider timeout');

    expect(provider.getCallCount()).toBe(1);
  });
});
