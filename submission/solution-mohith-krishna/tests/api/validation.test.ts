import { createTestContext, SEED_BALANCES, type TestContext } from '../setup/fixtures';
import { buildTransferPayload } from '../helpers/builders';

describe('Validation Failures', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.appContext.db.close();
  });

  it('should reject missing source_wallet_id', async () => {
    const full = buildTransferPayload();
    const { source_wallet_id: _omitted, ...payload } = full;
    const res = await ctx.api.createTransfer(payload as typeof full);
    expect(res.status).toBe(422);
  });

  it('should reject missing destination_wallet_id', async () => {
    const full = buildTransferPayload();
    const { destination_wallet_id: _omitted, ...payload } = full;
    const res = await ctx.api.createTransfer(payload as typeof full);
    expect(res.status).toBe(422);
  });

  it('should reject missing amount', async () => {
    const full = buildTransferPayload();
    const { amount: _omitted, ...payload } = full;
    const res = await ctx.api.createTransfer(payload as typeof full);
    expect(res.status).toBe(422);
  });

  it('should reject missing currency', async () => {
    const full = buildTransferPayload();
    const { currency: _omitted, ...payload } = full;
    const res = await ctx.api.createTransfer(payload as typeof full);
    expect(res.status).toBe(422);
  });

  it('should reject invalid currency', async () => {
    const payload = buildTransferPayload({ currency: 'XYZ' });
    const res = await ctx.api.createTransfer(payload);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid currency');
  });

  it('should reject negative amount', async () => {
    const payload = buildTransferPayload({ amount: -100 });
    const res = await ctx.api.createTransfer(payload);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('amount must be positive');
  });

  it('should reject zero amount', async () => {
    const payload = buildTransferPayload({ amount: 0 });
    const res = await ctx.api.createTransfer(payload);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('amount must be positive');
  });

  it('should reject same source and destination', async () => {
    const payload = buildTransferPayload({
      source_wallet_id: 'wallet_001',
      destination_wallet_id: 'wallet_001',
    });
    const res = await ctx.api.createTransfer(payload);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('source and destination must differ');
  });

  it('should reject non-existent source wallet', async () => {
    const payload = buildTransferPayload({ source_wallet_id: 'wallet_999' });
    const res = await ctx.api.createTransfer(payload);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('source wallet not found');
  });

  it('should reject non-existent destination wallet', async () => {
    const payload = buildTransferPayload({ destination_wallet_id: 'wallet_999' });
    const res = await ctx.api.createTransfer(payload);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('destination wallet not found');
  });

  it('should not create transfer record on invalid input', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: -999 }));

    const count = ctx.dbHelpers.getTransferCount();
    expect(count).toBe(0);
  });

  it('should leave balances unchanged on invalid input', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: 0 }));

    expect(ctx.dbHelpers.getWalletBalance('wallet_001')).toBe(SEED_BALANCES.wallet_001);
    expect(ctx.dbHelpers.getWalletBalance('wallet_002')).toBe(SEED_BALANCES.wallet_002);
  });

  it('should not create audit events on invalid input', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: -1 }));

    const count = ctx.dbHelpers.getAuditEventCount();
    expect(count).toBe(0);
  });

  it('should not create outbox events on invalid input', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: -1 }));

    const count = ctx.dbHelpers.getOutboxEventCount();
    expect(count).toBe(0);
  });
});
