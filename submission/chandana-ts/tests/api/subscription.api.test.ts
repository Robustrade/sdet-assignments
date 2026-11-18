
import request from 'supertest';
import { app, provider } from '../../src/app';
import db from '../../src/database/connection';
import { createHmac } from 'crypto';

const WEBHOOK_SECRET = 'test-webhook-secret';

describe('Subscription API', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM webhook_events').run();
    db.prepare('DELETE FROM audit_logs').run();
    db.prepare('DELETE FROM payments').run();
    db.prepare('DELETE FROM invoices').run();
    db.prepare('DELETE FROM subscriptions').run();
    provider.calls.length = 0;
    provider.setNextStatus('success');
  });

  // Helper to create a subscription
  const createSubscription = async (customerId: string) => {
    return request(app)
      .post('/subscriptions')
      .send({
        customer_id: customerId,
        plan: 'basic'
      });
  };

  // Helper to create an invoice and its payment attempt
  const createPendingInvoiceAndPayment = (
    subscriptionId: string,
    invoiceId: string,
    paymentId: string
  ) => {
    const timestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO invoices
      (id, subscription_id, amount, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      invoiceId,
      subscriptionId,
      1000,
      'pending',
      timestamp
    );

    db.prepare(`
      INSERT INTO payments
      (id, invoice_id, transaction_id, amount, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      paymentId,
      invoiceId,
      `txn-${paymentId}`,
      1000,
      'pending',
      timestamp
    );
  };

  // Helper to create and send a signed webhook
  const sendWebhook = async (payload: {
    event_id: string;
    type: 'payment.succeeded' | 'payment.failed' | 'payment.refunded';
    subscription_id: string;
    invoice_id: string;
  }) => {
    const signature = createHmac('sha256', WEBHOOK_SECRET)
      .update(JSON.stringify(payload))
      .digest('hex');

    return request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', signature)
      .send(payload);
  };

  it('should create a basic subscription', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customer_id: 'customer-api-001',
        plan: 'basic'
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.customer_id).toBe('customer-api-001');
    expect(response.body.plan).toBe('basic');
    expect(response.body.status).toBe('trialing');

  });

  it('should retrieve an existing subscription', async () => {
    const created = await createSubscription('customer-api-retrieve-001');
    const response = await request(app)
      .get(`/subscriptions/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(created.body.id);
    expect(response.body.status).toBe('trialing');
  });

  it('should return 404 for an invalid subscription ID', async () => {
    const response = await request(app)
      .get('/subscriptions/invalid-id');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Subscription not found');
  });

  it('should cancel a subscription', async () => {
    const created = await createSubscription('customer-api-cancel-001');
    const response = await request(app)
      .post(`/subscriptions/${created.body.id}/cancel`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('canceled');
    expect(response.body.canceled_at).not.toBeNull();
  });

  it('should reject cancellation of an already canceled subscription', async () => {
    const created = await createSubscription('customer-api-cancel-twice-001');
    await request(app).post(`/subscriptions/${created.body.id}/cancel`);

    const response = await request(app)
      .post(`/subscriptions/${created.body.id}/cancel`);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid transition');
  });

  it('should activate a subscription after successful payment', async () => {
    const created = await createSubscription('customer-payment-001');

    const response = await request(app)
      .post(`/subscriptions/${created.body.id}/pay`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('active');

    const invoice = db.prepare(`
      SELECT *
      FROM invoices
      WHERE subscription_id = ?
    `).get(created.body.id) as any;

    expect(invoice).toBeDefined();
    expect(invoice.status).toBe('succeeded');

    const payment = db.prepare(`
      SELECT *
      FROM payments
      WHERE invoice_id = ?
    `).get(invoice.id) as any;

    expect(payment).toBeDefined();
    expect(payment.status).toBe('succeeded');
  });

  it('should move a subscription to past_due after payment failure', async () => {
    provider.setNextStatus('declined');

    const created = await createSubscription('customer-payment-002');

    const response = await request(app)
      .post(`/subscriptions/${created.body.id}/pay`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('past_due');

    const invoice = db.prepare(`
      SELECT *
      FROM invoices
      WHERE subscription_id = ?
    `).get(created.body.id) as any;

    expect(invoice).toBeDefined();
    expect(invoice.status).toBe('failed');

    const payment = db.prepare(`
      SELECT *
      FROM payments
      WHERE invoice_id = ?
    `).get(invoice.id) as any;

    expect(payment).toBeDefined();
    expect(payment.status).toBe('failed');
  });

  it('should activate a subscription after payment success webhook', async () => {
    const created = await createSubscription('customer-webhook-001');

    const subscriptionId = created.body.id;
    const invoiceId = 'invoice-webhook-success-001';

    createPendingInvoiceAndPayment(
      subscriptionId,
      invoiceId,
      'payment-webhook-success-001'
    );

    const payload = {
      event_id: 'evt-success-001',
      type: 'payment.succeeded' as const,
      subscription_id: subscriptionId,
      invoice_id: invoiceId
    };

    const response = await sendWebhook(payload);

    expect(response.status).toBe(200);
    expect(response.body.received).toBe(true);
    expect(response.body.duplicate).toBe(false);

    const subscription = await request(app)
      .get(`/subscriptions/${subscriptionId}`);

    expect(subscription.body.status).toBe('active');

    const invoice = db.prepare(`
      SELECT *
      FROM invoices
      WHERE id = ?
    `).get(invoiceId) as any;

    expect(invoice).toBeDefined();
    expect(invoice.status).toBe('succeeded');

    const payment = db.prepare(`
      SELECT *
      FROM payments
      WHERE invoice_id = ?
    `).get(invoiceId) as any;

    expect(payment).toBeDefined();
    expect(payment.status).toBe('succeeded');
  });

  it('should reject a webhook with an invalid signature', async () => {
    const created = await createSubscription('customer-webhook-002');

    const response = await request(app)
      .post('/webhooks/payment-provider')
      .set('X-Provider-Signature', 'invalid-signature')
      .send({
        event_id: 'evt-invalid-001',
        type: 'payment.succeeded',
        subscription_id: created.body.id,
        invoice_id: 'invoice-invalid-001'
      });

    expect(response.status).toBe(401);
    expect(db.prepare(`
      SELECT COUNT(*) AS count
      FROM webhook_events
      WHERE event_id = ?
    `).get('evt-invalid-001')).toMatchObject({ count: 0 });
    expect(provider.calls).toHaveLength(0);

    const subscription = await request(app)
      .get(`/subscriptions/${created.body.id}`);

    expect(subscription.body.status).toBe('trialing');
  });

  it('should not process a duplicate webhook event twice', async () => {
    const created = await createSubscription('customer-webhook-003');

    const subscriptionId = created.body.id;
    const invoiceId = 'invoice-duplicate-001';

    createPendingInvoiceAndPayment(
      subscriptionId,
      invoiceId,
      'payment-duplicate-001'
    );

    const payload = {
      event_id: 'evt-duplicate-001',
      type: 'payment.succeeded' as const,
      subscription_id: subscriptionId,
      invoice_id: invoiceId
    };

    // First delivery
    const firstResponse = await sendWebhook(payload);

    // Second delivery of the same event
    const secondResponse = await sendWebhook(payload);

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.duplicate).toBe(false);

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.duplicate).toBe(true);

    // Verify only one webhook event was recorded
    const events = db.prepare(`
      SELECT *
      FROM webhook_events
      WHERE event_id = ?
    `).all('evt-duplicate-001');

    expect(events).toHaveLength(1);

    // Verify only one invoice exists
    const invoices = db.prepare(`
      SELECT *
      FROM invoices
      WHERE id = ?
    `).all(invoiceId);

    expect(invoices).toHaveLength(1);

    // Verify only one payment exists
    const payments = db.prepare(`
      SELECT *
      FROM payments
      WHERE invoice_id = ?
    `).all(invoiceId);

    expect(payments).toHaveLength(1);

    const payment = payments[0] as { status: string };
    expect(payment.status).toBe('succeeded');
  });

  it('should not regress active subscription or billing records on an old payment failure webhook', async () => {
    const created = await createSubscription('customer-webhook-004');

    const subscriptionId = created.body.id;
    const invoiceId = 'invoice-order-001';

    createPendingInvoiceAndPayment(
      subscriptionId,
      invoiceId,
      'payment-order-001'
    );

    // First: payment success
    const successResponse = await sendWebhook({
      event_id: 'evt-order-success-001',
      type: 'payment.succeeded',
      subscription_id: subscriptionId,
      invoice_id: invoiceId
    });

    expect(successResponse.status).toBe(200);

    // Second: delayed payment failure for the same invoice
    const failureResponse = await sendWebhook({
      event_id: 'evt-order-failure-001',
      type: 'payment.failed',
      subscription_id: subscriptionId,
      invoice_id: invoiceId
    });

    expect(failureResponse.status).toBe(200);

    const subscription = await request(app)
      .get(`/subscriptions/${subscriptionId}`);

    expect(subscription.body.status).toBe('active');

    // Verify invoice is still successful
    const invoice = db.prepare(`
      SELECT status
      FROM invoices
      WHERE id = ?
    `).get(invoiceId) as { status: string };

    expect(invoice.status).toBe('succeeded');

    // Verify payment is still successful
    const payment = db.prepare(`
      SELECT status
      FROM payments
      WHERE invoice_id = ?
    `).get(invoiceId) as { status: string };

    expect(payment.status).toBe('succeeded');
  });

  it('should update invoice and payment status after refund webhook', async () => {
    const created = await createSubscription('customer-refund-001');

    const subscriptionId = created.body.id;
    const invoiceId = 'invoice-refund-001';

    const timestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO invoices
      (id, subscription_id, amount, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      invoiceId,
      subscriptionId,
      1000,
      'succeeded',
      timestamp
    );

    db.prepare(`
      INSERT INTO payments
      (id, invoice_id, transaction_id, amount, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'payment-refund-001',
      invoiceId,
      'txn-refund-001',
      1000,
      'succeeded',
      timestamp
    );

    const response = await sendWebhook({
      event_id: 'evt-refund-001',
      type: 'payment.refunded',
      subscription_id: subscriptionId,
      invoice_id: invoiceId
    });

    expect(response.status).toBe(200);

    const invoice = db.prepare(`
      SELECT status
      FROM invoices
      WHERE id = ?
    `).get(invoiceId) as { status: string };

    const payment = db.prepare(`
      SELECT status
      FROM payments
      WHERE invoice_id = ?
    `).get(invoiceId) as { status: string };

    expect(invoice.status).toBe('refunded');
    expect(payment.status).toBe('refunded');
  });
});
