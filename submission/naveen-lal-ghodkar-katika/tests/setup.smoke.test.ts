import request from 'supertest';
import { createApp } from '../src/app';

describe('toolchain smoke test', () => {
  it('serves GET /health through Supertest', async () => {
    const res = await request(createApp()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(createApp()).get('/does-not-exist');

    expect(res.status).toBe(404);
  });

  it('supports jest.fn() mocks (for the future payment provider double)', () => {
    const charge = jest.fn().mockResolvedValue({ status: 'succeeded' });

    void charge({ amount: 4900 });

    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith({ amount: 4900 });
  });
});
