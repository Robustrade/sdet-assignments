import request from 'supertest';
import { createApp } from '../../src/app';
import { MockPaymentProvider } from '../../src/infrastructure/payment/mock-payment-provider';

describe('subscription billing integration flow', () => {
  it('keeps API-visible state and persistence aligned across multiple successful payments', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();

    const created = await request(testApp)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_integration_multi',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(201);

    expect(created.body.status).toBe('trialing');
    expect(testApp.locals.subscriptionRepository.findById(created.body.id)?.status).toBe('trialing');

    const firstPayment = provider.createWebhookPayload({
      event_id: 'evt_integration_payment_001',
      type: 'payment.succeeded',
      subscription_id: created.body.id,
      invoice_id: 'inv_integration_payment_001',
      amount: 2900,
      currency: 'USD',
    });

    const secondPayment = provider.createWebhookPayload({
      event_id: 'evt_integration_payment_002',
      type: 'payment.succeeded',
      subscription_id: created.body.id,
      invoice_id: 'inv_integration_payment_002',
      amount: 2900,
      currency: 'USD',
    });

    await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', provider.signWebhookPayload(firstPayment))
      .send(firstPayment)
      .expect(200);

    await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', provider.signWebhookPayload(secondPayment))
      .send(secondPayment)
      .expect(200);

    const fetched = await request(testApp).get(`/subscriptions/${created.body.id}`).expect(200);

    expect(fetched.body.status).toBe('active');
    expect(testApp.locals.subscriptionRepository.findById(created.body.id)?.status).toBe('active');
    expect(testApp.locals.invoiceRepository.findById('inv_integration_payment_001')).toMatchObject({
      amount: 2900,
      status: 'paid',
    });
    expect(testApp.locals.invoiceRepository.findById('inv_integration_payment_002')).toMatchObject({
      amount: 2900,
      status: 'paid',
    });
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_integration_payment_001')).toMatchObject({
      invoiceId: 'inv_integration_payment_001',
    });
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_integration_payment_002')).toMatchObject({
      invoiceId: 'inv_integration_payment_002',
    });
  });

  it('rejects a signed wrong-amount payment without mutating subscription, invoice, or event state', async () => {
    const testApp = createApp();
    const provider = new MockPaymentProvider();

    const created = await request(testApp)
      .post('/subscriptions')
      .send({
        customer_id: 'cust_integration_wrong_amount',
        plan: 'basic',
        payment_method_id: 'pm_test_visa_4242',
      })
      .expect(201);

    const wrongAmountPayment = provider.createWebhookPayload({
      event_id: 'evt_integration_wrong_amount',
      type: 'payment.succeeded',
      subscription_id: created.body.id,
      invoice_id: 'inv_integration_wrong_amount',
      amount: 4900,
      currency: 'USD',
    });

    const response = await request(testApp)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', provider.signWebhookPayload(wrongAmountPayment))
      .send(wrongAmountPayment)
      .expect(400);

    expect(response.body.message).toMatch(/does not match basic plan price/i);
    expect(testApp.locals.subscriptionRepository.findById(created.body.id)?.status).toBe('trialing');
    expect(testApp.locals.invoiceRepository.findById('inv_integration_wrong_amount')).toBeUndefined();
    expect(testApp.locals.webhookEventRepository.findByEventId('evt_integration_wrong_amount')).toBeUndefined();
  });
});
