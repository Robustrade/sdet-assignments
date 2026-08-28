import type { Invoice } from '../../src/domain/models/invoice';
import type { WebhookEvent } from '../../src/domain/models/webhook-event';
import type { Subscription } from '../../src/domain/models/subscription';
import { InMemoryInvoiceRepository } from '../../src/infrastructure/persistence/in-memory-invoice-repository';
import { InMemoryWebhookEventRepository } from '../../src/infrastructure/persistence/in-memory-webhook-event-repository';
import { InMemorySubscriptionRepository } from '../../src/infrastructure/persistence/in-memory-subscription-repository';

describe('In-memory persistence repositories', () => {
  describe('InMemoryInvoiceRepository', () => {
    const createInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
      id: 'inv_001',
      subscriptionId: 'sub_001',
      amount: 4900,
      currency: 'USD',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });

    it('findById() returns undefined when the invoice does not exist', () => {
      const repository = new InMemoryInvoiceRepository();

      expect(repository.findById('missing-invoice')).toBeUndefined();
    });

    it('save(), findById() and delete() work as expected', () => {
      const repository = new InMemoryInvoiceRepository();
      const invoice = createInvoice();

      repository.save(invoice);
      expect(repository.findById(invoice.id)).toEqual(invoice);

      repository.delete(invoice.id);
      expect(repository.findById(invoice.id)).toBeUndefined();
    });

    it('saving an invoice with the same ID replaces the previous invoice', () => {
      const repository = new InMemoryInvoiceRepository();
      const original = createInvoice({ id: 'inv_001', status: 'pending' });
      const replacement = createInvoice({
        id: 'inv_001',
        subscriptionId: 'sub_002',
        amount: 5900,
        currency: 'USD',
        status: 'paid',
        createdAt: '2026-01-02T00:00:00.000Z',
      });

      repository.save(original);
      repository.save(replacement);

      expect(repository.findById('inv_001')).toEqual(replacement);
    });
  });

  describe('InMemorySubscriptionRepository', () => {
    const createSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
      id: 'sub_001',
      customerId: 'cust_001',
      plan: 'pro',
      status: 'trialing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });

    it('findById() returns undefined when the subscription does not exist', () => {
      const repository = new InMemorySubscriptionRepository();

      expect(repository.findById('missing-sub')).toBeUndefined();
    });

    it('save(), findById() and delete() work as expected for subscriptions', () => {
      const repository = new InMemorySubscriptionRepository();
      const subscription = createSubscription();

      repository.save(subscription);
      expect(repository.findById(subscription.id)).toEqual(subscription);

      repository.delete(subscription.id);
      expect(repository.findById(subscription.id)).toBeUndefined();
    });

    it('saving two different subscriptions allows both to be retrieved independently', () => {
      const repository = new InMemorySubscriptionRepository();
      const sub1 = createSubscription({ id: 'sub_001', customerId: 'cust_001' });
      const sub2 = createSubscription({ id: 'sub_002', customerId: 'cust_002', plan: 'basic' });

      repository.save(sub1);
      repository.save(sub2);

      expect(repository.findById(sub1.id)).toEqual(sub1);
      expect(repository.findById(sub2.id)).toEqual(sub2);
    });

    it('saving a subscription with the same ID replaces the previously stored subscription', () => {
      const repository = new InMemorySubscriptionRepository();
      const original = createSubscription({ id: 'sub_001', status: 'trialing' });
      const replacement = createSubscription({
        id: 'sub_001',
        customerId: 'cust_updated',
        plan: 'basic',
        status: 'active',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });

      repository.save(original);
      repository.save(replacement);

      expect(repository.findById('sub_001')).toEqual(replacement);
    });

    it('deleting a non-existent subscription does not throw', () => {
      const repository = new InMemorySubscriptionRepository();

      expect(() => repository.delete('missing-sub')).not.toThrow();
    });
  });

  describe('InMemoryWebhookEventRepository', () => {
    const createWebhookEvent = (overrides: Partial<WebhookEvent> = {}): WebhookEvent => ({
      eventId: 'evt_001',
      subscriptionId: 'sub_001',
      invoiceId: 'inv_001',
      type: 'payment.succeeded',
      processedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    });

    it('findByEventId() returns undefined when the event does not exist', () => {
      const repository = new InMemoryWebhookEventRepository();

      expect(repository.findByEventId('missing-event')).toBeUndefined();
    });

    it('save(), findByEventId() and delete() work as expected for events', () => {
      const repository = new InMemoryWebhookEventRepository();
      const event = createWebhookEvent();

      repository.save(event);
      expect(repository.findByEventId(event.eventId)).toEqual(event);

      repository.delete(event.eventId);
      expect(repository.findByEventId(event.eventId)).toBeUndefined();
    });

    it('saving the same event ID replaces the previous event', () => {
      const repository = new InMemoryWebhookEventRepository();
      const original = createWebhookEvent({ eventId: 'evt_001', type: 'payment.succeeded' });
      const replacement = createWebhookEvent({
        eventId: 'evt_001',
        subscriptionId: 'sub_002',
        invoiceId: 'inv_002',
        type: 'payment.failed',
        processedAt: '2026-01-02T00:00:00.000Z',
      });

      repository.save(original);
      repository.save(replacement);

      expect(repository.findByEventId('evt_001')).toEqual(replacement);
    });
  });
});
