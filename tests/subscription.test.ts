import request from 'supertest';
import app from '../src/app';

describe('POST /subscriptions', () => {
  it('should create a subscription for a valid request', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_test_001',
        plan: 'basic',
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('id');
    expect(response.body.customerId).toBe('customer_test_001');
    expect(response.body.plan).toBe('basic');
    expect(response.body.status).toBe('trialing');
  });

  it('should generate a different ID for each subscription', async () => {
    const first = await request(app)
      .post('/subscriptions')
      .send({ customerId: 'customer_test_001', plan: 'basic' });

    const second = await request(app)
      .post('/subscriptions')
      .send({ customerId: 'customer_test_002', plan: 'pro' });

    expect(first.body.id).not.toBe(second.body.id);
  });

  it('should return 400 when customerId is missing', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({ plan: 'basic' });

    expect(response.status).toBe(400);
  });

  it('should return 400 for an invalid plan', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({ customerId: 'customer_test_003', plan: 'premium' });

    expect(response.status).toBe(400);
  });
});

describe('GET /subscriptions/:id', () => {
  it('should return a subscription by ID', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({ customerId: 'customer_get_001', plan: 'basic' });

    const response = await request(app)
      .get(`/subscriptions/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(created.body.id);
    expect(response.body.customerId).toBe('customer_get_001');
    expect(response.body.status).toBe('trialing');
  });

  it('should return 404 for a subscription that does not exist', async () => {
    const response = await request(app)
      .get('/subscriptions/not-existing');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Subscription not found');
  });
});

describe('POST /subscriptions/:id/cancel', () => {
  it('should cancel an existing subscription', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({ customerId: 'customer_cancel_001', plan: 'basic' });

    const response = await request(app)
      .post(`/subscriptions/${created.body.id}/cancel`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('canceled');
  });

  it('should return 404 when canceling a non-existing subscription', async () => {
    const response = await request(app)
      .post('/subscriptions/not-existing/cancel');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Subscription not found');
  });

  it('should keep canceled status when subscription is fetched', async () => {
    const created = await request(app)
      .post('/subscriptions')
      .send({ customerId: 'customer_cancel_002', plan: 'basic' });

    await request(app)
      .post(`/subscriptions/${created.body.id}/cancel`);

    const response = await request(app)
      .get(`/subscriptions/${created.body.id}`);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('canceled');
  });
});