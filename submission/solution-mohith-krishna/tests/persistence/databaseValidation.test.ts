import { createTestContext, SEED_BALANCES, type TestContext } from '../setup/fixtures';
import { buildTransferPayload, buildIdempotencyKey } from '../helpers/builders';

describe('Persistence and Auditability', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.appContext.db.close();
  });

  it('should persist transfer record fields matching API response exactly', async () => {
    const key = buildIdempotencyKey();
    const payload = buildTransferPayload({ amount: 1234, reference: 'ref-persist-001' });
    const res = await ctx.api.createTransfer(payload, key);
    const api = res.body;

    const db = ctx.dbHelpers.getTransfer(api.id);
    expect(db).toBeDefined();
    expect(db!.id).toBe(api.id);
    expect(db!.source_wallet_id).toBe(api.source_wallet_id);
    expect(db!.destination_wallet_id).toBe(api.destination_wallet_id);
    expect(db!.amount).toBe(api.amount);
    expect(db!.currency).toBe(api.currency);
    expect(db!.reference).toBe(api.reference);
    expect(db!.status).toBe(api.status);
    expect(db!.idempotency_key).toBe(api.idempotency_key);
  });

  it('should reflect correct net balances after multiple transfers', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: 1000 }));
    await ctx.api.createTransfer(buildTransferPayload({ amount: 2000 }));
    await ctx.api.createTransfer(buildTransferPayload({ amount: 500 }));

    const srcBalance = ctx.dbHelpers.getWalletBalance('wallet_001');
    const dstBalance = ctx.dbHelpers.getWalletBalance('wallet_002');

    expect(srcBalance).toBe(SEED_BALANCES.wallet_001 - 3500);
    expect(dstBalance).toBe(SEED_BALANCES.wallet_002 + 3500);
  });

  it('should persist audit event with correct payload', async () => {
    const payload = buildTransferPayload({ amount: 800 });
    const res = await ctx.api.createTransfer(payload);
    const transferId = res.body.id;

    const events = ctx.dbHelpers.getAuditEvents(transferId);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('transfer_completed');
    expect(events[0].transfer_id).toBe(transferId);

    const eventPayload = JSON.parse(events[0].payload!);
    expect(eventPayload.amount).toBe(800);
    expect(eventPayload.currency).toBe('AED');
  });

  it('should persist valid ISO timestamps', async () => {
    const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 100 }));
    const transferId = res.body.id;

    const transfer = ctx.dbHelpers.getTransfer(transferId);
    expect(transfer).toBeDefined();
    expect(() => new Date(transfer!.created_at)).not.toThrow();
    expect(new Date(transfer!.created_at).toISOString()).toBeTruthy();

    const events = ctx.dbHelpers.getAuditEvents(transferId);
    expect(events).toHaveLength(1);
    expect(() => new Date(events[0].created_at)).not.toThrow();
  });

  it('should not persist contradictory state (completed transfer + unchanged balance)', async () => {
    const amount = 2000;
    const res = await ctx.api.createTransfer(buildTransferPayload({ amount }));

    if (res.status === 201) {
      const transfer = ctx.dbHelpers.getTransfer(res.body.id);
      expect(transfer!.status).toBe('completed');

      const srcBalance = ctx.dbHelpers.getWalletBalance('wallet_001');
      expect(srcBalance).toBe(SEED_BALANCES.wallet_001 - amount);

      const dstBalance = ctx.dbHelpers.getWalletBalance('wallet_002');
      expect(dstBalance).toBe(SEED_BALANCES.wallet_002 + amount);
    }
  });

  it('should store idempotency key on transfer record', async () => {
    const key = buildIdempotencyKey();
    const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 300 }), key);

    const transfer = ctx.dbHelpers.getTransfer(res.body.id);
    expect(transfer).toBeDefined();
    expect(transfer!.idempotency_key).toBe(key);
  });

  it('should store null idempotency key when not provided', async () => {
    const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 300 }));

    const transfer = ctx.dbHelpers.getTransfer(res.body.id);
    expect(transfer).toBeDefined();
    expect(transfer!.idempotency_key).toBeNull();
  });

  it('should have payload_hash for idempotent transfers', async () => {
    const key = buildIdempotencyKey();
    const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 400 }), key);

    const transfer = ctx.dbHelpers.getTransfer(res.body.id);
    expect(transfer).toBeDefined();
    expect(transfer!.payload_hash).toBeTruthy();
    expect(typeof transfer!.payload_hash).toBe('string');
  });

  it('should not leave orphan audit events without matching transfer', async () => {
    await ctx.api.createTransfer(buildTransferPayload({ amount: 500 }));

    const transfers = ctx.dbHelpers.getAllTransfers();
    const transferIds = new Set(transfers.map(t => t.id));

    const allAudits = ctx.appContext.db.prepare('SELECT * FROM audit_events').all() as Array<{ transfer_id: string }>;
    for (const audit of allAudits) {
      expect(transferIds.has(audit.transfer_id)).toBe(true);
    }
  });

  it('should preserve total system balance across multiple mixed operations', async () => {
    const totalBefore = ctx.dbHelpers.getTotalBalanceForCurrency('AED');

    await ctx.api.createTransfer(buildTransferPayload({ amount: 1000 }));
    await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));
    await ctx.api.createTransfer(buildTransferPayload({ amount: 500, currency: 'XYZ' }));
    await ctx.api.createTransfer(buildTransferPayload({ amount: 2000 }));

    const totalAfter = ctx.dbHelpers.getTotalBalanceForCurrency('AED');
    expect(totalAfter).toBe(totalBefore);
  });
});
