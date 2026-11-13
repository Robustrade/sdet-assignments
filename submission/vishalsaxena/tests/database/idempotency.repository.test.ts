
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppDatabase, createDatabase } from '../../src/database/database';
import { IdempotencyRepository } from '../../src/repositories/IdempotencyRepository';

describe('Idempotency Repository', () => {
  let db: AppDatabase;
  let repository: IdempotencyRepository;

  beforeEach(async () => {
    db = await createDatabase();
    repository = new IdempotencyRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create and retrieve an idempotency key', () => {
    repository.create('key_001', 'hash_001');

    const result = repository.findByKey('key_001');

    expect(result).toBeDefined();
    expect(result?.requestHash).toBe('hash_001');
  });

  it('should return undefined for an unknown key', () => {
    expect(repository.findByKey('unknown')).toBeUndefined();
  });

  it('should save and retrieve the original response', () => {
    repository.create('key_002', 'hash_002');

    repository.saveResponse(
      'key_002',
      JSON.stringify({ subscriptionId: 'sub_001' }),
      201
    );

    const result = repository.findByKey('key_002');

    expect(result?.responseBody).toBe(
      JSON.stringify({ subscriptionId: 'sub_001' })
    );
    expect(result?.responseStatus).toBe(201);
  });

  it('should reject duplicate idempotency keys', () => {
    repository.create('key_003', 'hash_003');

    expect(() => {
      repository.create('key_003', 'hash_003');
    }).toThrow();
  });

  it('should reject response updates for unknown keys', () => {
    expect(() => {
      repository.saveResponse('unknown', '{}', 200);
    }).toThrow('Idempotency key not found: unknown');
  });
});
