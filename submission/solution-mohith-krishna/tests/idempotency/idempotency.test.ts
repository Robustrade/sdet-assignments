import { createTestContext, SEED_BALANCES, type TestContext } from '../setup/fixtures';
import { buildTransferPayload, buildIdempotencyKey } from '../helpers/builders';

describe('Idempotency / Duplicate Submission', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.appContext.db.close();
  });

  describe('same key + same payload', () => {
    it('should return original result on duplicate', async () => {
      const payload = buildTransferPayload({ amount: 1000 });
      const key = buildIdempotencyKey();

      const res1 = await ctx.api.createTransfer(payload, key);
      const res2 = await ctx.api.createTransfer(payload, key);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(200);
      expect(res1.body.id).toBe(res2.body.id);
    });

    it('should not double-debit source wallet', async () => {
      const payload = buildTransferPayload({ amount: 1000 });
      const key = buildIdempotencyKey();

      await ctx.api.createTransfer(payload, key);
      await ctx.api.createTransfer(payload, key);

      const balance = ctx.dbHelpers.getWalletBalance('wallet_001');
      expect(balance).toBe(SEED_BALANCES.wallet_001 - 1000);
    });

    it('should not double-credit destination wallet', async () => {
      const payload = buildTransferPayload({ amount: 1000 });
      const key = buildIdempotencyKey();

      await ctx.api.createTransfer(payload, key);
      await ctx.api.createTransfer(payload, key);

      const balance = ctx.dbHelpers.getWalletBalance('wallet_002');
      expect(balance).toBe(SEED_BALANCES.wallet_002 + 1000);
    });

    it('should create only one transfer row', async () => {
      const payload = buildTransferPayload({ amount: 1000 });
      const key = buildIdempotencyKey();

      await ctx.api.createTransfer(payload, key);
      await ctx.api.createTransfer(payload, key);

      const count = ctx.dbHelpers.getTransferCount();
      expect(count).toBe(1);
    });

    it('should create only one audit event', async () => {
      const payload = buildTransferPayload({ amount: 1000 });
      const key = buildIdempotencyKey();

      await ctx.api.createTransfer(payload, key);
      await ctx.api.createTransfer(payload, key);

      const count = ctx.dbHelpers.getAuditEventCount();
      expect(count).toBe(1);
    });

    it('should create only one outbox event', async () => {
      const payload = buildTransferPayload({ amount: 1000 });
      const key = buildIdempotencyKey();

      await ctx.api.createTransfer(payload, key);
      await ctx.api.createTransfer(payload, key);

      const count = ctx.dbHelpers.getOutboxEventCount();
      expect(count).toBe(1);
    });
  });

  describe('same key + different payload', () => {
    it('should return 409 conflict', async () => {
      const key = buildIdempotencyKey();

      await ctx.api.createTransfer(buildTransferPayload({ amount: 1000 }), key);
      const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 2000 }), key);

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('idempotency key conflict');
    });

    it('should not create a second transfer', async () => {
      const key = buildIdempotencyKey();

      await ctx.api.createTransfer(buildTransferPayload({ amount: 1000 }), key);
      await ctx.api.createTransfer(buildTransferPayload({ amount: 2000 }), key);

      const count = ctx.dbHelpers.getTransferCount();
      expect(count).toBe(1);
    });

    it('should preserve original debit amount', async () => {
      const key = buildIdempotencyKey();

      await ctx.api.createTransfer(buildTransferPayload({ amount: 1000 }), key);
      await ctx.api.createTransfer(buildTransferPayload({ amount: 2000 }), key);

      const balance = ctx.dbHelpers.getWalletBalance('wallet_001');
      expect(balance).toBe(SEED_BALANCES.wallet_001 - 1000);
    });
  });

  describe('no idempotency key', () => {
    it('should create independent transfers for identical payloads', async () => {
      const payload = buildTransferPayload({ amount: 100 });

      const res1 = await ctx.api.createTransfer(payload);
      const res2 = await ctx.api.createTransfer(payload);

      expect(res1.status).toBe(201);
      expect(res2.status).toBe(201);
      expect(res1.body.id).not.toBe(res2.body.id);

      const count = ctx.dbHelpers.getTransferCount();
      expect(count).toBe(2);
    });
  });

  describe('retry storm', () => {
    it('should settle to exactly one debit after 5 retries', async () => {
      const payload = buildTransferPayload({ amount: 2500 });
      const key = buildIdempotencyKey();

      for (let i = 0; i < 5; i++) {
        await ctx.api.createTransfer(payload, key);
      }

      const count = ctx.dbHelpers.getTransferCount();
      expect(count).toBe(1);

      const balance = ctx.dbHelpers.getWalletBalance('wallet_001');
      expect(balance).toBe(SEED_BALANCES.wallet_001 - 2500);
    });

    it('should return consistent transfer ID across all retries', async () => {
      const payload = buildTransferPayload({ amount: 500 });
      const key = buildIdempotencyKey();
      const ids: string[] = [];

      for (let i = 0; i < 5; i++) {
        const res = await ctx.api.createTransfer(payload, key);
        ids.push(res.body.id);
      }

      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(1);
    });
  });
});
