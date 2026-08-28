import { MockPaymentProvider } from '../src/infrastructure/payment/mock-payment-provider';
import type { ChargeCustomerArgs } from '../src/application/ports/payment-provider';
import {
  DefaultSubscriptionStateMachine,
  subscriptionStateMachine,
} from '../src/domain/state/subscription-state';
import { SubscriptionBuilder } from './builders/subscription-builder';
import { SubscriptionFixture } from './fixtures/subscription-fixture';

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

// Subscription state tests merged here to reduce test file count
const validTransitions = [
  ['trialing', 'active'],
  ['trialing', 'past_due'],
  ['trialing', 'canceled'],
  ['active', 'past_due'],
  ['active', 'canceled'],
  ['past_due', 'active'],
  ['past_due', 'canceled'],
] as const;

const trialRestartAttempts = [
  ['active', 'trialing'],
  ['past_due', 'trialing'],
  ['canceled', 'trialing'],
] as const;

const invalidTransitions = [
  ...trialRestartAttempts,
  ['active', 'active'],
  ['past_due', 'past_due'],
  ['trialing', 'trialing'],
  ['canceled', 'active'],
  ['canceled', 'past_due'],
  ['canceled', 'canceled'],
] as const;

describe('Subscription state machine', () => {
  const machine = new DefaultSubscriptionStateMachine();

  it.each(validTransitions)('canTransition() allows %s -> %s', (from, to) => {
    expect(machine.canTransition(from, to)).toBe(true);
    expect(subscriptionStateMachine.canTransition(from, to)).toBe(true);
  });

  it.each(validTransitions)('transition() returns expected value for %s -> %s', (from, to) => {
    expect(machine.transition(from, to)).toBe(`${from}->${to}`);
    expect(subscriptionStateMachine.transition(from, to)).toBe(`${from}->${to}`);
  });

  it.each(invalidTransitions)('canTransition() rejects %s -> %s', (from, to) => {
    expect(machine.canTransition(from, to)).toBe(false);
    expect(subscriptionStateMachine.canTransition(from, to)).toBe(false);
  });

  it.each(invalidTransitions)('transition() throws for %s -> %s', (from, to) => {
    expect(() => machine.transition(from, to)).toThrow(/Invalid subscription transition/i);
    expect(() => subscriptionStateMachine.transition(from, to)).toThrow(/Invalid subscription transition/i);
  });

  describe('customer cannot obtain another trial after the trial period has ended', () => {
    it('rejects restarting a trial after trialing → active', () => {
      const subscription = SubscriptionFixture.createDefault();
      expect(subscription.status).toBe('trialing');

      expect(machine.transition(subscription.status, 'active')).toBe('trialing->active');
      subscription.status = 'active';

      expect(machine.canTransition(subscription.status, 'trialing')).toBe(false);
      expect(() => machine.transition(subscription.status, 'trialing')).toThrow(
        /Invalid subscription transition: active -> trialing/i,
      );

      expect(subscription.status).toBe('active');
    });

    it.each(trialRestartAttempts)(
      'rejects consumed-trial restart attempt %s -> %s and leaves status unchanged',
      (from, to) => {
        const subscription = new SubscriptionBuilder().withDefaults().withStatus(from).build();

        expect(machine.canTransition(from, to)).toBe(false);
        expect(() => machine.transition(from, to)).toThrow(
          new RegExp(`Invalid subscription transition: ${from} -> ${to}`, 'i'),
        );
        expect(subscription.status).toBe(from);
      },
    );
  });
});
