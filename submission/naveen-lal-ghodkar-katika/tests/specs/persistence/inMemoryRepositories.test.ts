import { InMemoryAuditLogRepository } from '../../../src/persistence/InMemoryAuditLogRepository';
import { InMemoryInvoiceRepository } from '../../../src/persistence/InMemoryInvoiceRepository';
import { InMemoryWebhookEventRepository } from '../../../src/persistence/InMemoryWebhookEventRepository';
import { anInvoiceRecord } from '../../framework/builders/InvoiceRecordBuilder';

/**
 * The repositories are the test oracle for every persistence assertion, so their own contract is pinned
 * down: stored rows are copies (no aliasing with callers) and queries are ordered as documented.
 */
describe('in-memory repositories', () => {
  describe('InMemoryInvoiceRepository', () => {
    it('stores copies: changing a returned or saved object does not change the stored row', async () => {
      const repo = new InMemoryInvoiceRepository();
      const invoice = anInvoiceRecord().build();
      await repo.save(invoice);

      (invoice as { status: string }).status = 'paid';
      const found = (await repo.findById(invoice.id))!;
      (found as { status: string }).status = 'refunded';

      expect((await repo.findById(invoice.id))!.status).toBe('pending');
    });

    it('save replaces by id (no duplicate row) and findById returns undefined for unknown ids', async () => {
      const repo = new InMemoryInvoiceRepository();
      await repo.save(anInvoiceRecord().build());
      await repo.save(anInvoiceRecord().paid().build());

      expect(await repo.list()).toHaveLength(1);
      expect((await repo.findById('inv_seed_001'))!.status).toBe('paid');
      expect(await repo.findById('inv_nope')).toBeUndefined();
    });

    it('lists one subscription\'s invoices by attempt number, regardless of insertion order', async () => {
      const repo = new InMemoryInvoiceRepository();
      await repo.save(anInvoiceRecord().withId('inv_b').attempt(2).build());
      await repo.save(anInvoiceRecord().withId('inv_other').forSubscription('sub_other').build());
      await repo.save(anInvoiceRecord().withId('inv_a').attempt(1).build());

      const ids = (await repo.listBySubscription('sub_seed_001')).map((invoice) => invoice.id);

      expect(ids).toEqual(['inv_a', 'inv_b']);
    });
  });

  describe('InMemoryWebhookEventRepository', () => {
    const event = {
      eventId: 'evt_1',
      type: 'payment.succeeded',
      subscriptionId: 'sub_1',
      invoiceId: 'inv_1',
      outcome: 'processed',
      deliveryCount: 1,
      receivedAt: '2026-01-01T00:00:00.000Z',
      lastDeliveredAt: '2026-01-01T00:00:00.000Z',
    } as const;

    it('keys rows by event id and stores copies', async () => {
      const repo = new InMemoryWebhookEventRepository();
      await repo.save(event);
      await repo.save({ ...event, deliveryCount: 2 });

      expect(await repo.list()).toHaveLength(1);
      expect((await repo.findByEventId('evt_1'))!.deliveryCount).toBe(2);
      expect(await repo.findByEventId('evt_2')).toBeUndefined();
    });
  });

  describe('InMemoryAuditLogRepository', () => {
    const entry = (subscriptionId: string, to: 'active' | 'canceled') =>
      ({
        subscriptionId,
        from: 'trialing',
        to,
        trigger: 'cancel',
        source: 'api',
        at: '2026-01-01T00:00:00.000Z',
      }) as const;

    it('keeps append order and filters by subscription', async () => {
      const repo = new InMemoryAuditLogRepository();
      await repo.append(entry('sub_1', 'active'));
      await repo.append(entry('sub_2', 'canceled'));
      await repo.append(entry('sub_1', 'canceled'));

      expect((await repo.listBySubscription('sub_1')).map((e) => e.to)).toEqual(['active', 'canceled']);
      expect(await repo.list()).toHaveLength(3);
    });

    it('returned entries are copies', async () => {
      const repo = new InMemoryAuditLogRepository();
      await repo.append(entry('sub_1', 'active'));

      ((await repo.list())[0] as { to: string }).to = 'canceled';

      expect((await repo.list())[0].to).toBe('active');
    });
  });
});
