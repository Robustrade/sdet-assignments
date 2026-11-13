import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";

type SqlParameter = string | number | Uint8Array | null;

export class TestDatabase {
  private constructor(public readonly connection: SqlJsDatabase) {}

  static async create(): Promise<TestDatabase> {
    const SQL = await initSqlJs();
    const connection = new SQL.Database();

    connection.run("PRAGMA foreign_keys = ON");

    connection.run(`
      CREATE TABLE customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      );

      CREATE TABLE subscriptions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        payment_method_id TEXT NOT NULL,
        trial_ends_at TEXT,
        status TEXT NOT NULL CHECK (
          status IN ('trialing', 'active', 'past_due', 'canceled')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      );

      CREATE TABLE invoices (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('pending', 'succeeded', 'failed', 'refunded')
        ),
        provider_reference TEXT,
        failure_code TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
      );

      CREATE TABLE webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        delivery_count INTEGER NOT NULL DEFAULT 1,
        processed INTEGER NOT NULL DEFAULT 0,
        received_at TEXT NOT NULL,
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      );

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        previous_status TEXT,
        new_status TEXT,
        occurred_at TEXT NOT NULL,
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
      );

      CREATE INDEX idx_invoices_subscription
        ON invoices(subscription_id);

      CREATE INDEX idx_audit_subscription
        ON audit_events(subscription_id);
    `);

    return new TestDatabase(connection);
  }

  run(sql: string, parameters: SqlParameter[] = []): void {
    this.connection.run(sql, parameters);
  }

  get<T>(sql: string, parameters: SqlParameter[] = []): T | undefined {
    const statement = this.connection.prepare(sql);

    try {
      statement.bind(parameters);

      if (!statement.step()) {
        return undefined;
      }

      return statement.getAsObject() as unknown as T;
    } finally {
      statement.free();
    }
  }

  close(): void {
    this.connection.close();
  }
}