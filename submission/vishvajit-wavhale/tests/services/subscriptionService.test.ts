
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from 'vitest';

import { SqliteDatabase } from '../../src/database/Database.js';
import { initializeSchema } from '../../src/database/DatabaseSchema.js';
import { DatabaseSeeder } from '../../src/database/DatabaseSeeder.js';

import { CustomerRepository } from '../../src/repositories/CustomerRepository.js';
import { PlanRepository } from '../../src/repositories/PlanRepository.js';
import { SubscriptionRepository } from '../../src/repositories/SubscriptionRepository.js';
import { InvoiceRepository } from '../../src/repositories/InvoiceRepository.js';
import { AuditLogRepository } from '../../src/repositories/AuditLogRepository.js';

import { SubscriptionStateMachine } from '../../src/domain/subscription/SubscriptionStateMachine.js';
import { SubscriptionService } from '../../src/services/SubscriptionService.js';
import { MockPaymentProvider } from '../../src/payment/MockPaymentProvider.js';

describe('SubscriptionService', () => {
  let database: SqliteDatabase;
  let service: SubscriptionService;
  let subscriptionRepository: SubscriptionRepository;
  let auditLogRepository: AuditLogRepository;
  let invoiceRepository: InvoiceRepository;
  let paymentProvider: MockPaymentProvider;

  beforeEach(() => {
    database = new SqliteDatabase();

    initializeSchema(database.connection);

    new DatabaseSeeder(database.connection).seed();

    const customerRepository = new CustomerRepository(
      database.connection
    );

    const planRepository = new PlanRepository(
      database.connection
    );

    subscriptionRepository = new SubscriptionRepository(
      database.connection
    );

    invoiceRepository = new InvoiceRepository(
      database.connection
    );

    auditLogRepository = new AuditLogRepository(
      database.connection
    );

    const stateMachine = new SubscriptionStateMachine();

    paymentProvider = new MockPaymentProvider();

    service = new SubscriptionService(
      database.connection,
      customerRepository,
      planRepository,
      subscriptionRepository,
      invoiceRepository,
      auditLogRepository,
      stateMachine,
      paymentProvider
    );
  });

  afterEach(() => {
    database.close();
  });

  // Subscription creation tests

  it('should create a trialing subscription', () => {
    const subscription = service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa_4242'
    });

    expect(subscription.status).toBe('trialing');
    expect(subscription.customer_id).toBe('cust_001');
    expect(subscription.plan_id).toBe('plan_basic');
    expect(subscription.trial_ends_at).not.toBeNull();
  });

  it('should create an audit log when subscription is created', () => {
    service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa_4242'
    });

    const logs = auditLogRepository.findBySubscriptionId('sub_001');

    expect(logs).toHaveLength(1);
    expect(logs[0].event_type).toBe('subscription.created');
    expect(logs[0].new_state).toBe('trialing');
  });

  it('should reject subscription creation for an unknown customer', () => {
    expect(() => {
      service.createSubscription({
        id: 'sub_001',
        customerId: 'unknown_customer',
        planId: 'plan_basic',
        paymentMethodId: 'pm_test_visa_4242'
      });
    }).toThrow('Customer not found');
  });

  // Subscription state transition tests

  it('should transition trialing subscription to active', () => {
    service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa_4242'
    });

    const updated = service.applyEvent(
      'sub_001',
      'PAYMENT_SUCCEEDED',
      'webhook'
    );

    expect(updated.status).toBe('active');
  });

  it('should transition active subscription to past_due', () => {
    service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa_4242'
    });

    service.applyEvent(
      'sub_001',
      'PAYMENT_SUCCEEDED',
      'webhook'
    );

    const updated = service.applyEvent(
      'sub_001',
      'PAYMENT_FAILED',
      'webhook'
    );

    expect(updated.status).toBe('past_due');
  });

  it('should cancel a subscription', () => {
    service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa_4242'
    });

    const canceled = service.cancelSubscription('sub_001');

    expect(canceled.status).toBe('canceled');
    expect(canceled.canceled_at).not.toBeNull();
  });

  it('should reject reactivation of a canceled subscription', () => {
    service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa_4242'
    });

    service.cancelSubscription('sub_001');

    expect(() => {
      service.applyEvent(
        'sub_001',
        'PAYMENT_SUCCEEDED',
        'webhook'
      );
    }).toThrow();
  });

  it('should not create an audit log for an invalid transition', () => {
    service.createSubscription({
      id: 'sub_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa_4242'
    });

    expect(() => {
      service.applyEvent(
        'sub_001',
        'RETRIES_EXHAUSTED',
        'webhook'
      );
    }).toThrow();

    const logs = auditLogRepository.findBySubscriptionId('sub_001');

    expect(logs).toHaveLength(1);
    expect(logs[0].new_state).toBe('trialing');
  });

  // Payment integration tests

  it('should activate a trialing subscription after successful payment', async () => {
    service.createSubscription({
      id: 'sub_payment_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa'
    });

    paymentProvider.queueResult({
      status: 'succeeded',
      providerReference: 'pay_ref_001'
    });

    const result = await service.processPayment(
      'sub_payment_001',
      'inv_payment_001'
    );

    expect(result.subscription.status).toBe('active');
    expect(result.invoice?.status).toBe('succeeded');
    expect(result.invoice?.provider_reference).toBe('pay_ref_001');
    expect(paymentProvider.getCallCount()).toBe(1);

    expect(paymentProvider.getRequests()[0]).toMatchObject({
      subscriptionId: 'sub_payment_001',
      invoiceId: 'inv_payment_001',
      customerId: 'cust_001',
      paymentMethodId: 'pm_test_visa',
      amount: 1900,
      currency: 'USD',
      idempotencyKey: 'inv_payment_001'
    });
  });

  it('should move subscription to past_due after payment decline', async () => {
    service.createSubscription({
      id: 'sub_payment_002',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa'
    });

    paymentProvider.queueResult({
      status: 'declined',
      reason: 'Insufficient funds'
    });

    const result = await service.processPayment(
      'sub_payment_002',
      'inv_payment_002'
    );

    expect(result.subscription.status).toBe('past_due');
    expect(result.invoice?.status).toBe('failed');
    expect(result.invoice?.failure_reason).toBe('Insufficient funds');
    expect(paymentProvider.getCallCount()).toBe(1);
  });

  it('should keep invoice pending after payment timeout', async () => {
    service.createSubscription({
      id: 'sub_payment_003',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa'
    });

    paymentProvider.queueResult({
      status: 'timeout',
      reason: 'Gateway timeout'
    });

    const result = await service.processPayment(
      'sub_payment_003',
      'inv_payment_003'
    );

    expect(result.subscription.status).toBe('trialing');
    expect(result.invoice?.status).toBe('pending');
    expect(result.paymentResult.status).toBe('timeout');
    expect(paymentProvider.getCallCount()).toBe(1);
  });

  it('should reactivate a past_due subscription after successful retry', async () => {
    service.createSubscription({
      id: 'sub_payment_004',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa'
    });

    paymentProvider.queueResult({
      status: 'declined',
      reason: 'Temporary decline'
    });

    await service.processPayment(
      'sub_payment_004',
      'inv_payment_004a'
    );

    expect(
      subscriptionRepository.findById('sub_payment_004')?.status
    ).toBe('past_due');

    paymentProvider.queueResult({
      status: 'succeeded',
      providerReference: 'pay_ref_retry_001'
    });

    const retryResult = await service.processPayment(
      'sub_payment_004',
      'inv_payment_004b'
    );

    expect(retryResult.subscription.status).toBe('active');
    expect(retryResult.invoice?.status).toBe('succeeded');
    expect(paymentProvider.getCallCount()).toBe(2);
  });

  it('should not call payment provider for a canceled subscription', async () => {
    service.createSubscription({
      id: 'sub_payment_005',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa'
    });

    service.cancelSubscription('sub_payment_005');

    await expect(
      service.processPayment(
        'sub_payment_005',
        'inv_payment_005'
      )
    ).rejects.toThrow('Cannot charge a canceled subscription');

    expect(paymentProvider.getCallCount()).toBe(0);
    expect(invoiceRepository.findById('inv_payment_005')).toBeNull();
  });

  // Payment idempotency tests

  it('should not charge an already successful invoice again', async () => {
    service.createSubscription({
      id: 'sub_idempotency_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa'
    });

    paymentProvider.queueResult({
      status: 'succeeded',
      providerReference: 'pay_idempotent_001'
    });

    const firstResult = await service.processPayment(
      'sub_idempotency_001',
      'inv_idempotency_001'
    );

    const secondResult = await service.processPayment(
      'sub_idempotency_001',
      'inv_idempotency_001'
    );

    expect(firstResult.invoice?.status).toBe('succeeded');
    expect(secondResult.invoice?.status).toBe('succeeded');

    expect(secondResult.paymentResult).toEqual({
      status: 'succeeded',
      providerReference: 'pay_idempotent_001'
    });

    expect(paymentProvider.getCallCount()).toBe(1);

    expect(
      invoiceRepository.findBySubscriptionId('sub_idempotency_001')
    ).toHaveLength(1);
  });

  it('should not charge an already failed invoice again', async () => {
    service.createSubscription({
      id: 'sub_idempotency_002',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa'
    });

    paymentProvider.queueResult({
      status: 'declined',
      reason: 'Insufficient funds'
    });

    const firstResult = await service.processPayment(
      'sub_idempotency_002',
      'inv_idempotency_002'
    );

    const secondResult = await service.processPayment(
      'sub_idempotency_002',
      'inv_idempotency_002'
    );

    expect(firstResult.invoice?.status).toBe('failed');
    expect(secondResult.invoice?.status).toBe('failed');

    expect(secondResult.paymentResult).toEqual({
      status: 'declined',
      reason: 'Insufficient funds'
    });

    expect(paymentProvider.getCallCount()).toBe(1);

    expect(
      subscriptionRepository.findById('sub_idempotency_002')?.status
    ).toBe('past_due');

    expect(
      invoiceRepository.findBySubscriptionId('sub_idempotency_002')
    ).toHaveLength(1);
  });

  it('should safely retry a timed-out payment using the same invoice and idempotency key', async () => {
    service.createSubscription({
      id: 'sub_timeout_retry_001',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa'
    });

    paymentProvider.queueResult({
      status: 'timeout',
      reason: 'Gateway timeout'
    });

    const firstAttempt = await service.processPayment(
      'sub_timeout_retry_001',
      'inv_timeout_retry_001'
    );

    expect(firstAttempt.paymentResult.status).toBe('timeout');
    expect(firstAttempt.invoice?.status).toBe('pending');
    expect(firstAttempt.subscription.status).toBe('trialing');

    paymentProvider.queueResult({
      status: 'succeeded',
      providerReference: 'pay_timeout_retry_001'
    });

    const secondAttempt = await service.processPayment(
      'sub_timeout_retry_001',
      'inv_timeout_retry_001'
    );

    expect(secondAttempt.paymentResult).toEqual({
      status: 'succeeded',
      providerReference: 'pay_timeout_retry_001'
    });

    expect(secondAttempt.invoice?.status).toBe('succeeded');
    expect(secondAttempt.subscription.status).toBe('active');

    const requests = paymentProvider.getRequests();

    expect(requests).toHaveLength(2);
    expect(requests[0].invoiceId).toBe('inv_timeout_retry_001');
    expect(requests[1].invoiceId).toBe('inv_timeout_retry_001');

    expect(requests[0].idempotencyKey).toBe('inv_timeout_retry_001');
    expect(requests[1].idempotencyKey).toBe('inv_timeout_retry_001');

    expect(
      invoiceRepository.findBySubscriptionId('sub_timeout_retry_001')
    ).toHaveLength(1);
  });

  it('should reject reusing an invoice for a different subscription', async () => {
    service.createSubscription({
      id: 'sub_idempotency_003a',
      customerId: 'cust_001',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_visa'
    });

    service.createSubscription({
      id: 'sub_idempotency_003b',
      customerId: 'cust_002',
      planId: 'plan_basic',
      paymentMethodId: 'pm_test_mastercard'
    });

    await service.processPayment(
      'sub_idempotency_003a',
      'inv_shared_001'
    );

    await expect(
      service.processPayment(
        'sub_idempotency_003b',
        'inv_shared_001'
      )
    ).rejects.toThrow(
      'Existing invoice does not match the payment request'
    );

    expect(paymentProvider.getCallCount()).toBe(1);

    expect(
      invoiceRepository.findBySubscriptionId('sub_idempotency_003a')
    ).toHaveLength(1);

    expect(
      invoiceRepository.findBySubscriptionId('sub_idempotency_003b')
    ).toHaveLength(0);
  });
});
