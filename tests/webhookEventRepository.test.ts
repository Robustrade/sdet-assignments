
import { WebhookEventRepository } from '../src/repositories/webhookEventRepository';

describe('WebhookEventRepository', () => {
  let repository: WebhookEventRepository;

  const event = {
    id: 'event_1',
    eventType: 'payment.succeeded',
    subscriptionId: 'sub_1',
    processedAt: new Date(),
  };

  beforeEach(() => {
    repository = new WebhookEventRepository();
  });

  test('should save webhook event', () => {
    repository.save(event);
    expect(repository.findById('event_1')).toEqual(event);
  });

  test('should check if event exists', () => {
    repository.save(event);
    expect(repository.exists('event_1')).toBe(true);
    expect(repository.exists('unknown')).toBe(false);
  });

  test('should return all events', () => {
    repository.save(event);
    expect(repository.findAll()).toEqual([event]);
  });

  test('should return undefined for unknown event', () => {
    expect(repository.findById('unknown')).toBeUndefined();
  });
});
