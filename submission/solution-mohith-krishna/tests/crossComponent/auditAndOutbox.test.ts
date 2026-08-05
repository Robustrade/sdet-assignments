import { createTestContext, type TestContext } from '../setup/fixtures';
import { buildTransferPayload, buildIdempotencyKey } from '../helpers/builders';

describe('Cross-Component: Audit Events and Outbox', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.appContext.db.close();
  });

  describe('audit events', () => {
    it('should create exactly one audit event per successful transfer', async () => {
      const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 500 }));
      const transferId = res.body.id;

      const events = ctx.dbHelpers.getAuditEvents(transferId);
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('transfer_completed');
    });

    it('should not create audit events on failed transfers', async () => {
      await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));

      const count = ctx.dbHelpers.getAuditEventCount();
      expect(count).toBe(0);
    });

    it('should not duplicate audit events on idempotent replay', async () => {
      const key = buildIdempotencyKey();
      const payload = buildTransferPayload({ amount: 500 });

      const res1 = await ctx.api.createTransfer(payload, key);
      await ctx.api.createTransfer(payload, key);

      const events = ctx.dbHelpers.getAuditEvents(res1.body.id);
      expect(events).toHaveLength(1);
    });

    it('should include correct amount and currency in audit payload', async () => {
      const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 1500 }));
      const events = ctx.dbHelpers.getAuditEvents(res.body.id);

      const payload = JSON.parse(events[0].payload!);
      expect(payload.amount).toBe(1500);
      expect(payload.currency).toBe('AED');
    });

    it('should reference the correct transfer ID', async () => {
      const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 200 }));
      const transferId = res.body.id;

      const events = ctx.dbHelpers.getAuditEvents(transferId);
      expect(events[0].transfer_id).toBe(transferId);
    });

    it('should create one audit event per independent transfer', async () => {
      await ctx.api.createTransfer(buildTransferPayload({ amount: 100 }));
      await ctx.api.createTransfer(buildTransferPayload({ amount: 200 }));
      await ctx.api.createTransfer(buildTransferPayload({ amount: 300 }));

      const count = ctx.dbHelpers.getAuditEventCount();
      expect(count).toBe(3);
    });
  });

  describe('outbox events', () => {
    it('should create outbox event with pending status on success', async () => {
      const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 500 }));
      const transferId = res.body.id;

      const events = ctx.dbHelpers.getOutboxEvents(transferId);
      expect(events).toHaveLength(1);
      expect(events[0].status).toBe('pending');
      expect(events[0].event_type).toBe('transfer_completed');
    });

    it('should create exactly one outbox event per successful transfer', async () => {
      const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 700 }));
      const transferId = res.body.id;

      const events = ctx.dbHelpers.getOutboxEvents(transferId);
      expect(events).toHaveLength(1);
    });

    it('should not create outbox events on failed transfers', async () => {
      await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));

      const count = ctx.dbHelpers.getOutboxEventCount();
      expect(count).toBe(0);
    });

    it('should not duplicate outbox events on idempotent replay', async () => {
      const key = buildIdempotencyKey();
      const payload = buildTransferPayload({ amount: 500 });

      const res = await ctx.api.createTransfer(payload, key);
      await ctx.api.createTransfer(payload, key);
      await ctx.api.createTransfer(payload, key);

      const events = ctx.dbHelpers.getOutboxEvents(res.body.id);
      expect(events).toHaveLength(1);
    });

    it('should include transfer details in outbox payload', async () => {
      const payload = buildTransferPayload({ amount: 900 });
      const res = await ctx.api.createTransfer(payload);
      const transferId = res.body.id;

      const events = ctx.dbHelpers.getOutboxEvents(transferId);
      const outboxPayload = JSON.parse(events[0].payload!);

      expect(outboxPayload.transfer_id).toBe(transferId);
      expect(outboxPayload.amount).toBe(900);
      expect(outboxPayload.currency).toBe('AED');
      expect(outboxPayload.source_wallet_id).toBe(payload.source_wallet_id);
      expect(outboxPayload.destination_wallet_id).toBe(payload.destination_wallet_id);
    });

    it('should not create outbox events on validation failures', async () => {
      await ctx.api.createTransfer(buildTransferPayload({ amount: -1 }));
      await ctx.api.createTransfer(buildTransferPayload({ currency: 'INVALID' }));
      await ctx.api.createTransfer(buildTransferPayload({
        source_wallet_id: 'wallet_001',
        destination_wallet_id: 'wallet_001',
      }));

      const count = ctx.dbHelpers.getOutboxEventCount();
      expect(count).toBe(0);
    });
  });

  describe('cross-component consistency', () => {
    it('should have matching counts: transfers = audit events = outbox events', async () => {
      await ctx.api.createTransfer(buildTransferPayload({ amount: 100 }));
      await ctx.api.createTransfer(buildTransferPayload({ amount: 200 }));
      await ctx.api.createTransfer(buildTransferPayload({ amount: 99999 }));

      const transferCount = ctx.dbHelpers.getTransferCount();
      const auditCount = ctx.dbHelpers.getAuditEventCount();
      const outboxCount = ctx.dbHelpers.getOutboxEventCount();

      expect(transferCount).toBe(2);
      expect(auditCount).toBe(transferCount);
      expect(outboxCount).toBe(transferCount);
    });

    it('should have consistent timestamps across transfer, audit, and outbox', async () => {
      const res = await ctx.api.createTransfer(buildTransferPayload({ amount: 500 }));
      const transferId = res.body.id;

      const transfer = ctx.dbHelpers.getTransfer(transferId);
      const audits = ctx.dbHelpers.getAuditEvents(transferId);
      const outbox = ctx.dbHelpers.getOutboxEvents(transferId);

      const transferTime = new Date(transfer!.created_at).getTime();
      const auditTime = new Date(audits[0].created_at).getTime();
      const outboxTime = new Date(outbox[0].created_at).getTime();

      expect(Math.abs(transferTime - auditTime)).toBeLessThan(1000);
      expect(Math.abs(transferTime - outboxTime)).toBeLessThan(1000);
    });
  });
});
