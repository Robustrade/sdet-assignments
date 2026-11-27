import request from 'supertest';
import app from '../src/app';

describe('Subscription plan configuration', () => {
  it('should return price and trial duration for basic plan', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_plan_basic',
        plan: 'basic',
      });

    expect(response.status).toBe(201);
    expect(response.body.priceCents).toBe(99900);
    expect(response.body.trialDays).toBe(7);
  });

  it('should return price and trial duration for pro plan', async () => {
    const response = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_plan_pro',
        plan: 'pro',
      });

    expect(response.status).toBe(201);
    expect(response.body.priceCents).toBe(299900);
    expect(response.body.trialDays).toBe(14);
  });

  it('should have different prices and trial durations for plans', async () => {
    const basic = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_compare_basic',
        plan: 'basic',
      });

    const pro = await request(app)
      .post('/subscriptions')
      .send({
        customerId: 'customer_compare_pro',
        plan: 'pro',
      });

    expect(basic.body.priceCents).not.toBe(pro.body.priceCents);
    expect(basic.body.trialDays).not.toBe(pro.body.trialDays);
  });
});