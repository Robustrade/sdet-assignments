
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { IdempotencyRepository } from '../../src/repositories/IdempotencyRepository';
import { IdempotencyService } from '../../src/services/IdempotencyService';

describe('Idempotency Service', () => {
  let db: AppDatabase;
  let service: IdempotencyService;

  beforeEach(async () => {
    db = await createDatabase();

    const repository = new IdempotencyRepository(db);
    service = new IdempotencyService(repository);
  });

  afterEach(() => {
    db.close();
  });

  it('should accept a new idempotency key', () => {
    const result = service.checkRequest(
      'key_001',
      { customerId: 'cust_001', planId: 'premium' }
    );

    expect(result.isReplay).toBe(false);
  });

  it('should replay the original response for the same request', () => {
    const payload = {
      customerId: 'cust_001',
      planId: 'premium'
    };

    service.checkRequest('key_002', payload);

    const response = JSON.stringify({
      subscriptionId: 'sub_001'
    });

    service.saveResponse('key_002', response, 201);

    const result = service.checkRequest('key_002', payload);

    expect(result.isReplay).toBe(true);
    expect(result.responseBody).toBe(response);
    expect(result.responseStatus).toBe(201);
  });

  it('should reject reuse of a key with a different payload', () => {
    service.checkRequest('key_003', {
      customerId: 'cust_001',
      planId: 'premium'
    });

    expect(() => {
      service.checkRequest('key_003', {
        customerId: 'cust_001',
        planId: 'basic'
      });
    }).toThrow(
      'Idempotency key reused with a different request payload'
    );
  });

  it('should reject a request that is still processing', () => {
    service.checkRequest('key_004', {
      customerId: 'cust_001'
    });

    expect(() => {
      service.checkRequest('key_004', {
        customerId: 'cust_001'
      });
    }).toThrow(
      'Request with this idempotency key is still processing'
    );
  });

  it('should reject an empty idempotency key', () => {
    expect(() => {
      service.checkRequest('', { planId: 'premium' });
    }).toThrow('Idempotency key is required');
  });
});
