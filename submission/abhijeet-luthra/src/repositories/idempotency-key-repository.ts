import { Db } from '../db/database';
import { IdempotencyKeyRecord } from '../domain/types';

const COLUMNS = 'key, request_hash AS requestHash, subscription_id AS subscriptionId, created_at AS createdAt';

export class IdempotencyKeyRepository {
  constructor(private readonly db: Db) {}

  insert(record: IdempotencyKeyRecord): void {
    this.db
      .prepare(
        'INSERT INTO idempotency_keys (key, request_hash, subscription_id, created_at) VALUES (@key, @requestHash, @subscriptionId, @createdAt)',
      )
      .run(record);
  }

  findByKey(key: string): IdempotencyKeyRecord | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM idempotency_keys WHERE key = ?`).get(key) as
      | IdempotencyKeyRecord
      | undefined;
  }
}
