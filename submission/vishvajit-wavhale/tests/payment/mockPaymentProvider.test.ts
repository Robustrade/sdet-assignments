
import {
  describe,
  it,
  expect,
  beforeEach
} from 'vitest';

import { MockPaymentProvider } from '../../src/payment/MockPaymentProvider.js';

describe('MockPaymentProvider', () => {
  let provider: MockPaymentProvider;

  const chargeRequest = {
    subscriptionId: 'sub_001',
    invoiceId: 'inv_001',
    customerId: 'cust_001',
    paymentMethodId: 'pm_test_visa',
    amount: 1900,
    currency: 'USD',
    idempotencyKey: 'inv_001'
  };

  beforeEach(() => {
    provider = new MockPaymentProvider();
  });

  it('should return successful payment result by default', async () => {
    const result = await provider.charge(chargeRequest);

    expect(result.status).toBe('succeeded');

    if (result.status === 'succeeded') {
      expect(result.providerReference).toBe('mock_default');
    }
  });

  it('should simulate successful payment', async () => {
    provider.setNextResult({
      status: 'succeeded',
      providerReference: 'pay_123'
    });

    const result = await provider.charge(chargeRequest);

    expect(result).toEqual({
      status: 'succeeded',
      providerReference: 'pay_123'
    });
  });

  it('should simulate declined payment', async () => {
    provider.setNextResult({
      status: 'declined',
      reason: 'Insufficient funds'
    });

    const result = await provider.charge(chargeRequest);

    expect(result).toEqual({
      status: 'declined',
      reason: 'Insufficient funds'
    });
  });

  it('should simulate payment timeout', async () => {
    provider.setNextResult({
      status: 'timeout',
      reason: 'Gateway timeout'
    });

    const result = await provider.charge(chargeRequest);

    expect(result).toEqual({
      status: 'timeout',
      reason: 'Gateway timeout'
    });
  });

  it('should record provider call count', async () => {
    await provider.charge(chargeRequest);
    await provider.charge(chargeRequest);

    expect(provider.getCallCount()).toBe(2);
  });

  it('should record exact payment request arguments', async () => {
    await provider.charge(chargeRequest);

    expect(provider.getRequests()[0]).toEqual(chargeRequest);
  });

  it('should reset call history', async () => {
    await provider.charge(chargeRequest);

    provider.reset();

    expect(provider.getCallCount()).toBe(0);
    expect(provider.getRequests()).toHaveLength(0);
  });

  it('should allow changing the payment result between calls', async () => {
    const firstRequest = {
      ...chargeRequest,
      idempotencyKey: 'inv_001'
    };

    const secondRequest = {
      ...chargeRequest,
      invoiceId: 'inv_002',
      idempotencyKey: 'inv_002'
    };

    provider.setNextResult({
      status: 'declined',
      reason: 'Card declined'
    });

    const firstResult = await provider.charge(firstRequest);

    provider.setNextResult({
      status: 'succeeded',
      providerReference: 'pay_456'
    });

    const secondResult = await provider.charge(secondRequest);

    expect(firstResult.status).toBe('declined');
    expect(secondResult.status).toBe('succeeded');
    expect(provider.getCallCount()).toBe(2);
  });

  it('should return the cached result for duplicate idempotency keys', async () => {
    provider.setNextResult({
      status: 'succeeded',
      providerReference: 'pay_original'
    });

    const firstResult = await provider.charge(chargeRequest);

    provider.setNextResult({
      status: 'declined',
      reason: 'Should not be used'
    });

    const secondResult = await provider.charge(chargeRequest);

    expect(firstResult).toEqual({
      status: 'succeeded',
      providerReference: 'pay_original'
    });

    expect(secondResult).toEqual(firstResult);
    expect(provider.getCallCount()).toBe(2);
  });

  it('should allow retrying a timed-out payment with the same idempotency key', async () => {
    provider.setNextResult({
      status: 'timeout',
      reason: 'Gateway timeout'
    });

    const firstResult = await provider.charge(chargeRequest);

    provider.setNextResult({
      status: 'succeeded',
      providerReference: 'pay_retry_001'
    });

    const secondResult = await provider.charge(chargeRequest);

    expect(firstResult.status).toBe('timeout');

    expect(secondResult).toEqual({
      status: 'succeeded',
      providerReference: 'pay_retry_001'
    });

    expect(provider.getRequests()[0]?.idempotencyKey)
      .toBe(provider.getRequests()[1]?.idempotencyKey);
  });

  it('should cache declined results for duplicate idempotency keys', async () => {
    provider.setNextResult({
      status: 'declined',
      reason: 'Insufficient funds'
    });

    const firstResult = await provider.charge(chargeRequest);
    const secondResult = await provider.charge(chargeRequest);

    expect(firstResult).toEqual(secondResult);
    expect(secondResult.status).toBe('declined');
    expect(provider.getCallCount()).toBe(2);
  });
});
