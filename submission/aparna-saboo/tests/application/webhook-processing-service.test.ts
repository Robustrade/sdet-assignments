import { InMemoryInvoiceRepository } from '../../src/infrastructure/persistence/in-memory-invoice-repository';
import { InMemorySubscriptionRepository } from '../../src/infrastructure/persistence/in-memory-subscription-repository';
import { InMemoryWebhookEventRepository } from '../../src/infrastructure/persistence/in-memory-webhook-event-repository';
import { WebhookProcessingService } from '../../src/application/services/webhook-processing-service';
import type { Subscription } from '../../src/domain/models/subscription';
import type { Invoice } from '../../src/domain/models/invoice';
import type { WebhookEvent } from '../../src/domain/models/webhook-event';

describe('WebhookProcessingService', () => {
  const makeSubscription = (overrides: Partial<Subscription> = {}): Subscription => ({
    id: 'sub_001',
    customerId: 'cust_001',
    plan: 'pro',
    status: 'trialing',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice => ({
    id: 'inv_001',
    subscriptionId: 'sub_001',
    amount: 4900,
    currency: 'USD',
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  const makeEvent = (overrides: Partial<WebhookEvent> = {}): WebhookEvent => ({
    eventId: 'evt_001',
    subscriptionId: 'sub_001',
    invoiceId: 'inv_001',
    type: 'payment.succeeded',
    processedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  it('treats the same event_id as an idempotent duplicate', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    const subscription = makeSubscription({ id: 'sub_001', status: 'trialing' });
    subscriptionRepo.save(subscription);

    const event = makeEvent({ eventId: 'evt_dup', type: 'payment.succeeded' });

    const first = service.processWebhook(event, 4900, 'USD');
    const second = service.processWebhook(event, 4900, 'USD');

    expect(first).toEqual({ processed: true, duplicate: false });
    expect(second).toEqual({ processed: false, duplicate: true });
    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
    expect(webhookRepo.findByEventId('evt_dup')).toEqual(event);
  });

  it('duplicate payment.succeeded does not create another invoice', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'trialing' }));
    const event = makeEvent({ eventId: 'evt_001', type: 'payment.succeeded' });

    service.processWebhook(event, 4900, 'USD');
    service.processWebhook({ ...event, eventId: 'evt_002' }, 4900, 'USD');

    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
    expect(invoiceRepo.findById('inv_001')).toEqual(expect.objectContaining({ subscriptionId: 'sub_001' }));
  });

  it('duplicate payment.failed does not create another invoice', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'trialing' }));
    const event = makeEvent({ eventId: 'evt_001', type: 'payment.failed' });

    service.processWebhook(event, 4900, 'USD');
    service.processWebhook({ ...event, eventId: 'evt_002' }, 4900, 'USD');

    expect(invoiceRepo.findById('inv_001')?.status).toBe('failed');
  });

  it('duplicate event does not change an already-canceled subscription', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    const subscription = makeSubscription({ status: 'canceled' });
    subscriptionRepo.save(subscription);
    const event = makeEvent({ eventId: 'evt_001', type: 'payment.succeeded' });

    const first = service.processWebhook(event, 4900, 'USD');
    const second = service.processWebhook(event, 4900, 'USD');

    expect(first.processed).toBe(true);
    expect(second.duplicate).toBe(true);
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('canceled');
  });

  it('moves a trialing subscription to active when payment.succeeded is processed', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'trialing' }));

    const result = service.processWebhook(makeEvent({ eventId: 'evt_trial_to_active', type: 'payment.succeeded' }), 4900, 'USD');

    expect(result).toEqual({ processed: true, duplicate: false });
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
  });

  it('moves a past_due subscription to active when payment.succeeded is processed', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'past_due' }));

    service.processWebhook(makeEvent({ eventId: 'evt_past_due_active', type: 'payment.succeeded' }), 4900, 'USD');

    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
  });

  it('keeps an already active subscription active for payment.succeeded', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'active' }));
    invoiceRepo.save(makeInvoice({ id: 'inv_001', status: 'paid' }));

    const result = service.processWebhook(makeEvent({ eventId: 'evt_active_stays_active', type: 'payment.succeeded' }), 4900, 'USD');

    expect(result).toEqual({ processed: true, duplicate: false });
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
  });

  it('keeps a canceled subscription canceled for payment.succeeded', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'canceled' }));

    const result = service.processWebhook(makeEvent({ eventId: 'evt_canceled_succeeded', type: 'payment.succeeded' }), 4900, 'USD');

    expect(result).toEqual({ processed: true, duplicate: false });
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('canceled');
  });

  it('moves a trialing subscription to past_due when payment.failed is processed', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'trialing' }));

    service.processWebhook(makeEvent({ eventId: 'evt_trial_to_past_due', type: 'payment.failed' }), 4900, 'USD');

    expect(subscriptionRepo.findById('sub_001')?.status).toBe('past_due');
    expect(invoiceRepo.findById('inv_001')?.status).toBe('failed');
  });

  it('moves an active subscription to past_due when payment.failed is processed', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'active' }));

    service.processWebhook(makeEvent({ eventId: 'evt_active_past_due', type: 'payment.failed' }), 4900, 'USD');

    expect(subscriptionRepo.findById('sub_001')?.status).toBe('past_due');
  });

  it('keeps a past_due subscription at past_due for payment.failed', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'past_due' }));

    service.processWebhook(makeEvent({ eventId: 'evt_past_due_stays_past_due', type: 'payment.failed' }), 4900, 'USD');

    expect(subscriptionRepo.findById('sub_001')?.status).toBe('past_due');
  });

  it('keeps a canceled subscription canceled for payment.failed', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'canceled' }));

    const result = service.processWebhook(makeEvent({ eventId: 'evt_canceled_failed', type: 'payment.failed' }), 4900, 'USD');

    expect(result).toEqual({ processed: true, duplicate: false });
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('canceled');
  });

  it('marks the invoice as refunded and leaves the subscription state unchanged', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'active' }));

    const result = service.processWebhook(makeEvent({ eventId: 'evt_refund', type: 'payment.refunded' }), 4900, 'USD');

    expect(result).toEqual({ processed: true, duplicate: false });
    expect(invoiceRepo.findById('inv_001')?.status).toBe('refunded');
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
  });

  it('does not regress a paid invoice when a failed event arrives later for the same invoice', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'active' }));
    invoiceRepo.save(makeInvoice({ status: 'paid' }));

    service.processWebhook(makeEvent({ eventId: 'evt_late_failed', type: 'payment.failed' }), 4900, 'USD');

    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
  });

  it('moves a past_due subscription back to active when a later succeeded event arrives for the same invoice', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'past_due' }));
    invoiceRepo.save(makeInvoice({ status: 'failed' }));

    service.processWebhook(makeEvent({ eventId: 'evt_late_success', type: 'payment.succeeded' }), 4900, 'USD');

    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
  });

  it('does not reactivate a refunded invoice with a later succeeded event', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'active' }));
    invoiceRepo.save(makeInvoice({ status: 'refunded' }));

    service.processWebhook(makeEvent({ eventId: 'evt_late_refund_success', type: 'payment.succeeded' }), 4900, 'USD');

    expect(invoiceRepo.findById('inv_001')?.status).toBe('refunded');
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
  });

  it('throws and does not persist when the subscription does not exist', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    expect(() => service.processWebhook(makeEvent({ eventId: 'evt_missing_sub' }), 4900, 'USD')).toThrow('Subscription not found');
    expect(invoiceRepo.findById('inv_001')).toBeUndefined();
    expect(webhookRepo.findByEventId('evt_missing_sub')).toBeUndefined();
  });

  it('persists a successfully processed invoice and event', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'trialing' }));
    const event = makeEvent({ eventId: 'evt_persisted', type: 'payment.succeeded' });

    const result = service.processWebhook(event, 4900, 'USD');

    expect(result).toEqual({ processed: true, duplicate: false });
    expect(invoiceRepo.findById('inv_001')?.status).toBe('paid');
    expect(webhookRepo.findByEventId('evt_persisted')).toEqual(event);
  });

  it('persists the subscription state in the repository after processing', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'trialing' }));

    service.processWebhook(makeEvent({ eventId: 'evt_sub_state', type: 'payment.succeeded' }), 4900, 'USD');

    expect(subscriptionRepo.findById('sub_001')?.status).toBe('active');
  });

  it('does not call an invalid state transition for canceled + payment.succeeded', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'canceled' }));

    const result = service.processWebhook(makeEvent({ eventId: 'evt_canceled_succeeded_2', type: 'payment.succeeded' }), 4900, 'USD');

    expect(result).toEqual({ processed: true, duplicate: false });
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('canceled');
  });

  it('does not call an invalid state transition for canceled + payment.failed', () => {
    const subscriptionRepo = new InMemorySubscriptionRepository();
    const invoiceRepo = new InMemoryInvoiceRepository();
    const webhookRepo = new InMemoryWebhookEventRepository();
    const service = new WebhookProcessingService(subscriptionRepo, invoiceRepo, webhookRepo);

    subscriptionRepo.save(makeSubscription({ status: 'canceled' }));

    const result = service.processWebhook(makeEvent({ eventId: 'evt_canceled_failed_2', type: 'payment.failed' }), 4900, 'USD');

    expect(result).toEqual({ processed: true, duplicate: false });
    expect(subscriptionRepo.findById('sub_001')?.status).toBe('canceled');
  });
});
