import { TestDatabase } from "./database";

export type InvoiceStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "refunded";

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  providerReference?: string;
  failureCode?: string;
  idempotencyKey: string;
  createdAt: string;
}

interface InvoiceRow {
  id: string;
  subscription_id: string;
  amount: number;
  currency: string;
  status: string;
  provider_reference: string | null;
  failure_code: string | null;
  idempotency_key: string;
  created_at: string;
}

function mapInvoice(row: InvoiceRow): Invoice {
  return {
    id: row.id,
    subscriptionId: row.subscription_id,
    amount: row.amount,
    currency: row.currency,
    status: row.status as InvoiceStatus,
    ...(row.provider_reference
      ? { providerReference: row.provider_reference }
      : {}),
    ...(row.failure_code
      ? { failureCode: row.failure_code }
      : {}),
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at
  };
}

export class InvoiceRepository {
  constructor(private readonly database: TestDatabase) {}

  save(invoice: Invoice): void {
    this.database.run(
      `INSERT INTO invoices
       (id, subscription_id, amount, currency, status,
        provider_reference, failure_code, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoice.id,
        invoice.subscriptionId,
        invoice.amount,
        invoice.currency,
        invoice.status,
        invoice.providerReference ?? null,
        invoice.failureCode ?? null,
        invoice.idempotencyKey,
        invoice.createdAt
      ]
    );
  }

  findById(id: string): Invoice | undefined {
    const row = this.database.get<InvoiceRow>(
      "SELECT * FROM invoices WHERE id = ?",
      [id]
    );

    return row ? mapInvoice(row) : undefined;
  }

  findByIdempotencyKey(key: string): Invoice | undefined {
    const row = this.database.get<InvoiceRow>(
      "SELECT * FROM invoices WHERE idempotency_key = ?",
      [key]
    );

    return row ? mapInvoice(row) : undefined;
  }

  updatePaymentResult(
    id: string,
    status: InvoiceStatus,
    providerReference?: string,
    failureCode?: string
  ): void {
    this.database.run(
      `UPDATE invoices
       SET status = ?, provider_reference = ?, failure_code = ?
       WHERE id = ?`,
      [
        status,
        providerReference ?? null,
        failureCode ?? null,
        id
      ]
    );
  }

  findBySubscription(subscriptionId: string): Invoice[] {
    const statement = this.database.connection.prepare(
      "SELECT * FROM invoices WHERE subscription_id = ? ORDER BY created_at",
      [subscriptionId]
    );

    const invoices: Invoice[] = [];

    try {
      while (statement.step()) {
        invoices.push(mapInvoice(statement.getAsObject() as unknown as InvoiceRow));
      }
    } finally {
      statement.free();
    }

    return invoices;
  }
}