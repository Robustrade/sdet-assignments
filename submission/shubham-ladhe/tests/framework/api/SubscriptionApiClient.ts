import type { Server } from 'http';
import request, { Response } from 'supertest';
import { z } from 'zod';
import { ErrorBody, errorContract, SubscriptionBody, subscriptionContract } from './contracts';

export type ApiResult<T> =
  | { ok: true; status: number; body: T; headers: Record<string, string> }
  | { ok: false; status: number; body: ErrorBody; headers: Record<string, string> };

export class ContractViolation extends Error {
  constructor(where: string, issues: z.core.$ZodIssue[], body: unknown) {
    super(`${where} response broke its contract:\n${JSON.stringify(issues, null, 2)}\nbody: ${JSON.stringify(body)}`);
    this.name = 'ContractViolation';
  }
}

/**
 * Typed client over the HTTP API. Tests talk to this, never to supertest directly, so transport
 * details live in one place - and every response is contract-checked on the way through.
 */
export class SubscriptionApiClient {
  constructor(private readonly server: Server) {}

  async create(body: unknown, options: { idempotencyKey?: string } = {}): Promise<ApiResult<SubscriptionBody>> {
    let req = request(this.server).post('/subscriptions').set('Content-Type', 'application/json');
    if (options.idempotencyKey) req = req.set('Idempotency-Key', options.idempotencyKey);
    const response = typeof body === 'string' ? await req.send(body) : await req.send(body as object);
    return this.decode('POST /subscriptions', response, subscriptionContract);
  }

  async get(id: string): Promise<ApiResult<SubscriptionBody>> {
    return this.decode('GET /subscriptions/:id', await request(this.server).get(`/subscriptions/${id}`), subscriptionContract);
  }

  async cancel(id: string): Promise<ApiResult<SubscriptionBody>> {
    return this.decode(
      'POST /subscriptions/:id/cancel',
      await request(this.server).post(`/subscriptions/${id}/cancel`),
      subscriptionContract,
    );
  }

  /** Convenience for arrange steps: fails loudly if the call didn't succeed. */
  async createOk(body: unknown, options: { idempotencyKey?: string } = {}): Promise<SubscriptionBody> {
    return expectOk(await this.create(body, options));
  }

  async getOk(id: string): Promise<SubscriptionBody> {
    return expectOk(await this.get(id));
  }

  private decode<T>(where: string, response: Response, contract: z.ZodType<T>): ApiResult<T> {
    const headers = response.headers as Record<string, string>;
    if (response.status >= 200 && response.status < 300) {
      const parsed = contract.safeParse(response.body);
      if (!parsed.success) throw new ContractViolation(where, parsed.error.issues, response.body);
      return { ok: true, status: response.status, body: parsed.data, headers };
    }
    const parsed = errorContract.safeParse(response.body);
    if (!parsed.success) throw new ContractViolation(`${where} (error)`, parsed.error.issues, response.body);
    return { ok: false, status: response.status, body: parsed.data, headers };
  }
}

export function expectOk<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`Expected success, got ${result.status}: ${JSON.stringify(result.body)}`);
  return result.body;
}
