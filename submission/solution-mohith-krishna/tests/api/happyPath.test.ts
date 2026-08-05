import { createTestContext, SEED_BALANCES, type TestContext } from '../setup/fixtures';
import { buildTransferPayload, buildIdempotencyKey } from '../helpers/builders';

describe('Happy Path Transfer', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.appContext.db.close();
  });

  it('should return 201 with correct payload shape', async () => {
    const payload = buildTransferPayload();
    const res = await ctx.api.createTransfer(payload, buildIdempotencyKey());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.any(String),
      source_wallet_id: payload.source_wallet_id,
      destination_wallet_id: payload.destination_wallet_id,
      amount: payload.amount,
      currency: payload.currency,
      status: 'completed',
      created_at: expect.any(String),
    });
  });

  it('should debit source wallet exactly once', async () => {
    const amount = 1000;
    const payload = buildTransferPayload({ amount });
    await ctx.api.createTransfer(payload);

    const balance = ctx.dbHelpers.getWalletBalance('wallet_001');
    expect(balance).toBe(SEED_BALANCES.wallet_001 - amount);
  });

  it('should credit destination wallet exactly once', async () => {
    const amount = 1000;
    const payload = buildTransferPayload({ amount });
    await ctx.api.createTransfer(payload);

    const balance = ctx.dbHelpers.getWalletBalance('wallet_002');
    expect(balance).toBe(SEED_BALANCES.wallet_002 + amount);
  });

  it('should conserve total balance (zero-sum invariant)', async () => {
    const totalBefore = ctx.dbHelpers.getTotalBalanceForCurrency('AED');

    const payload = buildTransferPayload({ amount: 3000 });
    await ctx.api.createTransfer(payload);

    const totalAfter = ctx.dbHelpers.getTotalBalanceForCurrency('AED');
    expect(totalAfter).toBe(totalBefore);
  });

  it('should net balance movement equal transfer amount', async () => {
    const amount = 3000;
    const srcBefore = ctx.dbHelpers.getWalletBalance('wallet_001');
    const dstBefore = ctx.dbHelpers.getWalletBalance('wallet_002');

    await ctx.api.createTransfer(buildTransferPayload({ amount }));

    const srcAfter = ctx.dbHelpers.getWalletBalance('wallet_001');
    const dstAfter = ctx.dbHelpers.getWalletBalance('wallet_002');

    expect(srcBefore - srcAfter).toBe(amount);
    expect(dstAfter - dstBefore).toBe(amount);
  });

  it('should persist transfer record with correct fields', async () => {
    const payload = buildTransferPayload({ amount: 500 });
    const res = await ctx.api.createTransfer(payload);
    const transferId = res.body.id;

    const record = ctx.dbHelpers.getTransfer(transferId);
    expect(record).toBeDefined();
    expect(record!.status).toBe('completed');
    expect(record!.amount).toBe(500);
    expect(record!.source_wallet_id).toBe(payload.source_wallet_id);
    expect(record!.destination_wallet_id).toBe(payload.destination_wallet_id);
  });

  it('should return consistent state via GET /transfers/:id', async () => {
    const payload = buildTransferPayload({ amount: 300 });
    const postRes = await ctx.api.createTransfer(payload);
    const transferId = postRes.body.id;

    const getRes = await ctx.api.getTransfer(transferId);
    expect(getRes.status).toBe(200);
    expect(getRes.body.status).toBe('completed');
    expect(getRes.body.id).toBe(transferId);
    expect(getRes.body.amount).toBe(300);
  });

  it('should reflect updated balance via GET /wallets/:id', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: 2000 }));

    const res = await ctx.api.getWallet('wallet_001');
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(SEED_BALANCES.wallet_001 - 2000);
  });

  it('should have API response matching DB state (cross-layer consistency)', async () => {
    const payload = buildTransferPayload({ amount: 750 });
    const res = await ctx.api.createTransfer(payload);
    const apiBody = res.body;

    const dbRow = ctx.dbHelpers.getTransfer(apiBody.id);
    expect(dbRow).toBeDefined();
    expect(dbRow!.status).toBe(apiBody.status);
    expect(dbRow!.amount).toBe(apiBody.amount);
    expect(dbRow!.source_wallet_id).toBe(apiBody.source_wallet_id);
    expect(dbRow!.destination_wallet_id).toBe(apiBody.destination_wallet_id);
    expect(dbRow!.currency).toBe(apiBody.currency);
  });

  it('should return 404 for non-existent transfer', async () => {
    const res = await ctx.api.getTransfer('non-existent-id');
    expect(res.status).toBe(404);
  });

  it('should return 404 for non-existent wallet', async () => {
    const res = await ctx.api.getWallet('non-existent-wallet');
    expect(res.status).toBe(404);
  });
});
