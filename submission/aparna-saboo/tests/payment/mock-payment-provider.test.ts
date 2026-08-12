import { MockPaymentProvider } from '../../src/infrastructure/payment/mock-payment-provider';
import type { ChargeCustomerArgs } from '../../src/application/ports/payment-provider';

describe('MockPaymentProvider', () => {
  const baseArgs: ChargeCustomerArgs = {
    customerId: 'cust_001',
    amount: 4900,
    currency: 'USD',
    paymentMethodId: 'pm_test_visa_4242',
    subscriptionId: 'sub_001',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns success and records exact arguments', async () => {
    const provider = new MockPaymentProvider();

    const result = await provider.chargeCustomer(baseArgs);

    expect(result.success).toBe(true);
    expect(result.outcome).toBe('success');
    expect(result.providerReference).toBe('mock-ref-1');
    expect(provider.callCount).toBe(1);
    expect(provider.getCalls()).toEqual([baseArgs]);
  });

  it('supports decline outcome and records error and arguments', async () => {
    const provider = new MockPaymentProvider();
    provider.configureOutcome('decline');

    const result = await provider.chargeCustomer(baseArgs);

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('decline');
    expect(result.error).toBe(`Payment declined for customer ${baseArgs.customerId}`);
    expect(provider.callCount).toBe(1);
    expect(provider.getCalls()).toEqual([baseArgs]);
  });

  it('supports timeout outcome and distinguishes it from decline', async () => {
    const provider = new MockPaymentProvider();
    provider.configureOutcome('timeout');

    const result = await provider.chargeCustomer(baseArgs);

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('timeout');
    expect(result.error).toBe(`Payment timeout for customer ${baseArgs.customerId}`);
    expect(provider.getCalls()).toEqual([baseArgs]);
  });

  it('records one charge call exactly once', async () => {
    const provider = new MockPaymentProvider();

    await provider.chargeCustomer(baseArgs);

    expect(provider.callCount).toBe(1);
    expect(provider.getCalls()).toEqual([baseArgs]);
  });

  it('records two charge calls exactly twice with exact arguments', async () => {
    const provider = new MockPaymentProvider();
    const secondArgs: ChargeCustomerArgs = {
      ...baseArgs,
      customerId: 'cust_002',
      paymentMethodId: 'pm_test_mastercard_5555',
      subscriptionId: 'sub_002',
      amount: 5900,
    };

    await provider.chargeCustomer(baseArgs);
    await provider.chargeCustomer(secondArgs);

    expect(provider.callCount).toBe(2);
    expect(provider.getCalls()).toEqual([baseArgs, secondArgs]);
  });

  it('reset clears recorded calls and resets outcome', async () => {
    const provider = new MockPaymentProvider();
    provider.configureOutcome('decline');
    await provider.chargeCustomer(baseArgs);

    provider.reset();

    expect(provider.callCount).toBe(0);
    expect(provider.getCalls()).toEqual([]);

    const resetResult = await provider.chargeCustomer(baseArgs);
    expect(resetResult.outcome).toBe('success');
    expect(resetResult.providerReference).toBe('mock-ref-1');
  });

  it('creates a deterministic webhook payload and signature', () => {
    const provider = new MockPaymentProvider();
    const payload = provider.createWebhookPayload();
    const signature = provider.signWebhookPayload(payload);

    expect(payload).toEqual({
      event_id: 'evt_001',
      type: 'payment.succeeded',
      subscription_id: 'sub_001',
      invoice_id: 'inv_001',
      amount: 4900,
      currency: 'USD',
    });
    expect(signature).toMatch(/^sha256=/);
    expect(provider.signWebhookPayload(payload)).toBe(signature);
  });

  it('can generate a valid and an invalid signature for the same payload shape', () => {
    const provider = new MockPaymentProvider();
    const payload = provider.createWebhookPayload();
    const validSignature = provider.signWebhookPayload(payload);
    const invalidSignature = 'sha256=invalid-signature';

    expect(validSignature).not.toBe(invalidSignature);
    expect(validSignature).toContain('sha256=');
    expect(invalidSignature).toContain('sha256=');
  });
});
