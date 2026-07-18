import http from 'http';
import { createTestContext, SEED_BALANCES, type TestContext } from '../setup/fixtures';
import { buildTransferPayload, buildIdempotencyKey } from '../helpers/builders';
import type { TransferPayload } from '../helpers/builders';

let server: http.Server;
let baseUrl: string;
let ctx: TestContext;

function postTransfer(payload: TransferPayload, idempotencyKey?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url = new URL('/transfers', baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data).toString(),
    };
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    const req = http.request(url, { method: 'POST', headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode!, body: JSON.parse(body) });
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

describe('Concurrency and Race Conditions', () => {
  beforeEach((done) => {
    ctx = createTestContext();
    server = http.createServer(ctx.appContext.app);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  afterEach((done) => {
    ctx.appContext.db.close();
    server.close(done);
  });

  it('should never allow balance to go negative under concurrent transfers', async () => {
    const amount = 3000;
    const maxPossibleSuccesses = Math.floor(SEED_BALANCES.wallet_001 / amount);

    const promises = Array.from({ length: 5 }, () =>
      postTransfer(buildTransferPayload({ amount }))
    );
    const results = await Promise.all(promises);

    const successes = results.filter(r => r.status === 201).length;
    const rejections = results.filter(r => r.status === 422).length;

    expect(successes).toBeLessThanOrEqual(maxPossibleSuccesses);
    expect(successes + rejections).toBe(5);

    const balance = ctx.dbHelpers.getWalletBalance('wallet_001');
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBe(SEED_BALANCES.wallet_001 - successes * amount);
  });

  it('should produce exactly one transfer for concurrent duplicate idempotency keys', async () => {
    const payload = buildTransferPayload({ amount: 1000 });
    const key = buildIdempotencyKey();

    const promises = Array.from({ length: 10 }, () =>
      postTransfer(payload, key)
    );
    const results = await Promise.all(promises);

    const statuses = results.map(r => r.status);
    expect(statuses.every(s => s === 200 || s === 201)).toBe(true);

    const transferCount = ctx.dbHelpers.getTransferCount();
    expect(transferCount).toBe(1);

    const balance = ctx.dbHelpers.getWalletBalance('wallet_001');
    expect(balance).toBe(SEED_BALANCES.wallet_001 - 1000);
  });

  it('should return the same transfer ID for all concurrent duplicate requests', async () => {
    const payload = buildTransferPayload({ amount: 500 });
    const key = buildIdempotencyKey();

    const promises = Array.from({ length: 5 }, () =>
      postTransfer(payload, key)
    );
    const results = await Promise.all(promises);

    const ids = results.map(r => r.body.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(1);
  });

  it('should correctly accumulate credits under concurrent transfers to same destination', async () => {
    const amount = 500;
    const concurrentCount = 4;

    const promises = Array.from({ length: concurrentCount }, () =>
      postTransfer(buildTransferPayload({ amount }))
    );
    const results = await Promise.all(promises);

    const successes = results.filter(r => r.status === 201).length;
    expect(successes).toBe(concurrentCount);

    const dstBalance = ctx.dbHelpers.getWalletBalance('wallet_002');
    expect(dstBalance).toBe(SEED_BALANCES.wallet_002 + successes * amount);

    const srcBalance = ctx.dbHelpers.getWalletBalance('wallet_001');
    expect(srcBalance).toBe(SEED_BALANCES.wallet_001 - successes * amount);
  });

  it('should preserve zero-sum invariant under concurrent transfers', async () => {
    const totalBefore = ctx.dbHelpers.getTotalBalanceForCurrency('AED');

    const promises = Array.from({ length: 5 }, (_, i) =>
      postTransfer(buildTransferPayload({ amount: 1000 + i * 100 }))
    );
    await Promise.all(promises);

    const totalAfter = ctx.dbHelpers.getTotalBalanceForCurrency('AED');
    expect(totalAfter).toBe(totalBefore);
  });

  it('should create correct number of audit events under concurrency', async () => {
    const promises = Array.from({ length: 3 }, () =>
      postTransfer(buildTransferPayload({ amount: 500 }))
    );
    const results = await Promise.all(promises);

    const successes = results.filter(r => r.status === 201).length;
    const auditCount = ctx.dbHelpers.getAuditEventCount();
    expect(auditCount).toBe(successes);
  });

  it('should create correct number of outbox events under concurrency', async () => {
    const promises = Array.from({ length: 3 }, () =>
      postTransfer(buildTransferPayload({ amount: 500 }))
    );
    const results = await Promise.all(promises);

    const successes = results.filter(r => r.status === 201).length;
    const outboxCount = ctx.dbHelpers.getOutboxEventCount();
    expect(outboxCount).toBe(successes);
  });
});
