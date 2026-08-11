import type { WebhookEvent } from '../../src/domain/models/webhook-event';
import { InMemoryWebhookEventRepository } from '../../src/infrastructure/persistence/in-memory-webhook-event-repository';

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

  it('save() persists a webhook event and findByEventId() returns the same event', () => {
    const repository = new InMemoryWebhookEventRepository();
    const event = createWebhookEvent();

    repository.save(event);

    expect(repository.findByEventId(event.eventId)).toEqual(event);
  });

  it('delete() removes an existing event', () => {
    const repository = new InMemoryWebhookEventRepository();
    const event = createWebhookEvent();

    repository.save(event);
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
