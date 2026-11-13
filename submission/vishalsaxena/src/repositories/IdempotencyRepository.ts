
import { AppDatabase } from '../database/database';

export interface IdempotencyRecord {
  idempotencyKey: string;
  requestHash: string;
  responseBody?: string;
  responseStatus?: number;
}

export class IdempotencyRepository {
  constructor(private db: AppDatabase) {}

  create(idempotencyKey: string, requestHash: string): void {
    this.db.run(
      `INSERT INTO idempotency_keys
       (idempotency_key, request_hash)
       VALUES (?, ?)`,
      [idempotencyKey, requestHash]
    );
  }

  findByKey(idempotencyKey: string): IdempotencyRecord | undefined {
    const statement = this.db.prepare(
      `SELECT * FROM idempotency_keys
       WHERE idempotency_key = ?`
    );

    try {
      statement.bind([idempotencyKey]);

      if (!statement.step()) {
        return undefined;
      }

      const row = statement.getAsObject() as Record<string, unknown>;

      return {
        idempotencyKey: row.idempotency_key as string,
        requestHash: row.request_hash as string,
        responseBody: row.response_body as string | undefined,
        responseStatus: row.response_status as number | undefined
      };
    } finally {
      statement.free();
    }
  }

  saveResponse(
    idempotencyKey: string,
    responseBody: string,
    responseStatus: number
  ): void {
    this.db.run(
      `UPDATE idempotency_keys
       SET response_body = ?, response_status = ?
       WHERE idempotency_key = ?`,
      [responseBody, responseStatus, idempotencyKey]
    );

    if (this.db.getRowsModified() === 0) {
      throw new Error(`Idempotency key not found: ${idempotencyKey}`);
    }
  }
}
