import { ProviderTimeoutError, type ChargeRequest } from '../../../src/providers/PaymentProvider';
import { MockPaymentProvider } from '../../framework/doubles/MockPaymentProvider';

/** The test double is test infrastructure, so its own contract is pinned down here. */
describe('MockPaymentProvider (test double)', () => {
  const request: ChargeRequest = {
    customerId: 'cust_001',
    paymentMethodId: 'pm_test_visa_4242',
    amount: 1900,
    currency: 'USD',
    idempotencyKey: 'initial:sub_001',
    reference: 'sub_001',
  };

  let provider: MockPaymentProvider;

  beforeEach(() => {
    provider = new MockPaymentProvider();
  });

  it('succeeds by default and returns a provider charge id', async () => {
    await expect(provider.charge(request)).resolves.toEqual({
      status: 'succeeded',
      providerChargeId: 'ch_mock_001',
    });
  });

  it('declines with the configured decline code', async () => {
    provider.willDecline('insufficient_funds');

    await expect(provider.charge(request)).resolves.toEqual({
      status: 'declined',
      declineCode: 'insufficient_funds',
    });
  });

  it('times out by rejecting with ProviderTimeoutError', async () => {
    provider.willTimeout();

    await expect(provider.charge(request)).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it('consumes one-shot outcomes in order, then falls back to the default', async () => {
    provider.timeoutOnce().declineOnce('do_not_honor');

    await expect(provider.charge(request)).rejects.toBeInstanceOf(ProviderTimeoutError);
    await expect(provider.charge(request)).resolves.toMatchObject({ status: 'declined', declineCode: 'do_not_honor' });
    await expect(provider.charge(request)).resolves.toMatchObject({ status: 'succeeded' });
  });

  it('records every call, including the ones that time out or decline', async () => {
    provider.timeoutOnce().declineOnce();

    await provider.charge(request).catch(() => undefined);
    await provider.charge({ ...request, amount: 4900 });

    expect(provider.charge).toHaveBeenCalledTimes(2);
    expect(provider.calls.map((call) => call.amount)).toEqual([1900, 4900]);
  });

  it('hands out a copy of the recorded arguments, so tests cannot corrupt the record', async () => {
    await provider.charge(request);

    provider.calls[0].amount = 1;

    expect(provider.calls[0].amount).toBe(1900);
  });
});
