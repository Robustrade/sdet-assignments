import { MockPaymentProvider } from '../src/providers/paymentProvider';

describe('Mock Payment Provider', () => {
  let provider: MockPaymentProvider;

  beforeEach(() => {
    provider = new MockPaymentProvider();
  });

  it('should return success for successful payment', async () => {
    provider.setNextResult('success');

    const result = await provider.processPayment(99900);

    expect(result.status).toBe('success');

    if (result.status === 'success') {
      expect(result.transactionId).toBeDefined();
    }
  });

  it('should return declined for declined payment', async () => {
    provider.setNextResult('declined');

    const result = await provider.processPayment(99900);

    expect(result.status).toBe('declined');

    if (result.status === 'declined') {
      expect(result.message).toBe('Payment was declined');
    }
  });

  it('should return timeout for timed out payment', async () => {
    provider.setNextResult('timeout');

    const result = await provider.processPayment(99900);

    expect(result.status).toBe('timeout');

    if (result.status === 'timeout') {
      expect(result.message).toBe('Payment provider timed out');
    }
  });

  it('should decline payment when amount is zero or negative', async () => {
    const result = await provider.processPayment(0);

    expect(result.status).toBe('declined');
  });

  it('should reset next result to success after processing', async () => {
    provider.setNextResult('declined');

    await provider.processPayment(99900);

    const result = await provider.processPayment(99900);

    expect(result.status).toBe('success');
  });
});