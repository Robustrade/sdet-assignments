import type { APIRequestContext, APIResponse } from '@playwright/test';

export type TransferRequest = {
  source_wallet_id: string;
  destination_wallet_id: string;
  amount: number;
  currency: string;
  reference?: string;
};

/**
 * Typed wrapper around Playwright's APIRequestContext.
 * No test spec should call ctx.post / ctx.get directly — all HTTP concerns live here.
 */
export class ApiClient {
  constructor(private readonly ctx: APIRequestContext) {}

  /** Happy-path transfer — enforces idempotency key at the type level. */
  createTransfer(body: TransferRequest, idempotencyKey: string): Promise<APIResponse> {
    return this.ctx.post('/transfers', {
      data: body,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  }

  /**
   * Raw transfer — used by validation tests that intentionally send bad payloads
   * or omit the idempotency key header.
   */
  createTransferRaw(body: unknown, headers: Record<string, string> = {}): Promise<APIResponse> {
    return this.ctx.post('/transfers', {
      data: body as Record<string, unknown>,
      headers,
    });
  }

  getTransfer(id: string): Promise<APIResponse> {
    return this.ctx.get(`/transfers/${id}`);
  }

  getWallet(id: string): Promise<APIResponse> {
    return this.ctx.get(`/wallets/${id}`);
  }
}
