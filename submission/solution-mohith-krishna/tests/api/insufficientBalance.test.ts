import { createTestContext, SEED_BALANCES, type TestContext } from '../setup/fixtures';
import { buildTransferPayload } from '../helpers/builders';

describe('Insufficient Balance', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.appContext.db.close();
  });

  it('should return 422 when balance is insufficient', async () => {
    const payload = buildTransferPayload({ amount: 99999 });
    const res = await ctx.api.createTransfer(payload);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('insufficient balance');
  });

  it('should leave source balance unchanged', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));

    const balance = ctx.dbHelpers.getWalletBalance('wallet_001');
    expect(balance).toBe(SEED_BALANCES.wallet_001);
  });

  it('should leave destination balance unchanged', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));

    const balance = ctx.dbHelpers.getWalletBalance('wallet_002');
    expect(balance).toBe(SEED_BALANCES.wallet_002);
  });

  it('should not create transfer record', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));

    const count = ctx.dbHelpers.getTransferCount();
    expect(count).toBe(0);
  });

  it('should not create audit event', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));

    const count = ctx.dbHelpers.getAuditEventCount();
    expect(count).toBe(0);
  });

  it('should not create outbox event', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));

    const count = ctx.dbHelpers.getOutboxEventCount();
    expect(count).toBe(0);
  });

  it('should reject transfer from zero-balance wallet', async () => {
    const payload = buildTransferPayload({
      source_wallet_id: 'wallet_003',
      destination_wallet_id: 'wallet_001',
      amount: 1,
    });
    const res = await ctx.api.createTransfer(payload);
    expect(res.status).toBe(422);
  });

  it('should succeed when transferring exact balance', async () => {
    const payload = buildTransferPayload({ amount: SEED_BALANCES.wallet_001 });
    const res = await ctx.api.createTransfer(payload);

    expect(res.status).toBe(201);
    const balance = ctx.dbHelpers.getWalletBalance('wallet_001');
    expect(balance).toBe(0);
  });

  it('should conserve total balance even on rejection', async () => {
    const totalBefore = ctx.dbHelpers.getTotalBalanceForCurrency('AED');

    await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));

    const totalAfter = ctx.dbHelpers.getTotalBalanceForCurrency('AED');
    expect(totalAfter).toBe(totalBefore);
  });
});
