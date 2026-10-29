import type { ApiResult } from '../clients/BillingApiClient';

const SUBSCRIPTION_KEYS = [
  'id',
  'customer_id',
  'plan',
  'status',
  'price',
  'currency',
  'trial_ends_at',
  'created_at',
].sort();

/** API-level assertions: payload shape and error envelope. */
export const BillingAssertions = {
  expectSubscriptionShape(body: Record<string, unknown>): void {
    expect(Object.keys(body).sort()).toEqual(SUBSCRIPTION_KEYS);
  },

  /** A webhook the service accepted: always 200, with how it was handled. */
  expectWebhookAck(res: ApiResult, status: 'processed' | 'duplicate' | 'ignored'): void {
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status });
  },

  expectError(res: ApiResult, status: number, code: string): void {
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: { code, message: expect.any(String) } });
  },
};
