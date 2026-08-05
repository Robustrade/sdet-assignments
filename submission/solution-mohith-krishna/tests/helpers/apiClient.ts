import supertest from 'supertest';
import type express from 'express';
import type { TransferPayload } from './builders';

export class ApiClient {
  private agent: ReturnType<typeof supertest>;

  constructor(app: express.Express) {
    this.agent = supertest(app);
  }

  async createTransfer(payload: TransferPayload, idempotencyKey?: string) {
    const req = this.agent.post('/transfers').send(payload);
    if (idempotencyKey) {
      req.set('Idempotency-Key', idempotencyKey);
    }
    return req;
  }

  async getTransfer(transferId: string) {
    return this.agent.get(`/transfers/${transferId}`);
  }

  async getWallet(walletId: string) {
    return this.agent.get(`/wallets/${walletId}`);
  }
}
