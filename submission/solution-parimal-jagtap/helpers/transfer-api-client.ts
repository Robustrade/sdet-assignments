import { APIRequestContext } from '@playwright/test';

export interface TransferPayload {
  source_wallet_id: string;
  destination_wallet_id: string;
  amount: number;
  currency: string;
  reference: string;
}

export interface TransferResponse {
  transfer_id: string;
  source_wallet_id: string;
  destination_wallet_id: string;
  amount: number;
  currency: string;
  reference: string;
  status: 'COMPLETED' | 'FAILED' | 'PENDING';
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletResponse {
  wallet_id: string;
  balance: number;
  currency: string;
  created_at: string;
}

export class TransferApiClient {
  constructor(private request: APIRequestContext) {}

  async createTransfer(payload: TransferPayload, idempotencyKey?: string) {
    const headers: Record<string, string> = {};
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    return this.request.post('/transfers', { data: payload, headers });
  }

  async getTransfer(transferId: string) {
    return this.request.get(`/transfers/${transferId}`);
  }

  async getWallet(walletId: string) {
    return this.request.get(`/wallets/${walletId}`);
  }

  // Test-only: reset DB between tests
  async resetDatabase() {
    return this.request.post('/test/reset');
  }
}
