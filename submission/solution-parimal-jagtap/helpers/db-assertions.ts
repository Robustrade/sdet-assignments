/**
 * DB Assertions
 *
 * Queries the in-memory DB via test-only endpoints.
 * Every critical test asserts DB state directly —
 * API responses alone are never trusted.
 */

export class DbAssertions {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async getTransferRecord(transferId: string) {
    const res = await fetch(`${this.baseUrl}/test/db/transfers/${transferId}`);
    if (res.status === 404) return null;
    return res.json();
  }

  async getWalletBalance(walletId: string): Promise<number> {
    const res = await fetch(`${this.baseUrl}/wallets/${walletId}`);
    const data = await res.json();
    return data.balance;
  }

  async getIdempotencyRecord(key: string) {
    const res = await fetch(`${this.baseUrl}/test/db/idempotency/${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    return res.json();
  }

  async getAuditEvent(transferId: string) {
    const res = await fetch(`${this.baseUrl}/test/db/events/${transferId}`);
    if (res.status === 404) return null;
    return res.json();
  }

  async getOutboxEvent(transferId: string) {
    const res = await fetch(`${this.baseUrl}/test/db/outbox/${transferId}`);
    if (res.status === 404) return null;
    return res.json();
  }
}
