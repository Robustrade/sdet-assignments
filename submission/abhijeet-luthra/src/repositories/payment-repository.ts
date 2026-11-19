import { Db } from '../db/database';
import { Payment } from '../domain/types';

const COLUMNS = `id, invoice_id AS invoiceId, subscription_id AS subscriptionId, attempt_number AS attemptNumber,
  idempotency_key AS idempotencyKey, provider_reference AS providerReference, amount_minor AS amountMinor,
  currency, status, failure_code AS failureCode, created_at AS createdAt, updated_at AS updatedAt`;

export class PaymentRepository {
  constructor(private readonly db: Db) {}

  insert(p: Payment): void {
    this.db
      .prepare(
        `INSERT INTO payments (id, invoice_id, subscription_id, attempt_number, idempotency_key, provider_reference,
           amount_minor, currency, status, failure_code, created_at, updated_at)
         VALUES (@id, @invoiceId, @subscriptionId, @attemptNumber, @idempotencyKey, @providerReference,
           @amountMinor, @currency, @status, @failureCode, @createdAt, @updatedAt)`,
      )
      .run(p);
  }

  /** Persists outcome fields. The payment state machine must approve the status change first. */
  update(p: Payment): void {
    this.db
      .prepare(
        `UPDATE payments SET status = @status, provider_reference = @providerReference,
           failure_code = @failureCode, updated_at = @updatedAt WHERE id = @id`,
      )
      .run(p);
  }

  findById(id: string): Payment | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM payments WHERE id = ?`).get(id) as Payment | undefined;
  }

  findByInvoice(invoiceId: string): Payment[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM payments WHERE invoice_id = ? ORDER BY attempt_number`)
      .all(invoiceId) as Payment[];
  }

  findBySubscription(subscriptionId: string): Payment[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM payments WHERE subscription_id = ? ORDER BY created_at, attempt_number`)
      .all(subscriptionId) as Payment[];
  }

  findByProviderReference(reference: string): Payment | undefined {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM payments WHERE provider_reference = ?`)
      .get(reference) as Payment | undefined;
  }
}
