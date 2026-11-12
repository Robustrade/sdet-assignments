import { DatabaseSync } from "node:sqlite";
import { Invoice, PaymentEvent, Subscription, SubscriptionState } from "./domain.ts";

type SqlRow = Record<string, unknown>;

const subscriptionStates: Readonly<Record<string, SubscriptionState>> = Object.freeze({
  TRIALING: SubscriptionState.TRIALING,
  ACTIVE: SubscriptionState.ACTIVE,
  PAST_DUE: SubscriptionState.PAST_DUE,
  CANCELED: SubscriptionState.CANCELED,
});

function readString(row: SqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`Expected ${column} to be text in the database`);
  }
  return value;
}

function readNumber(row: SqlRow, column: string): number {
  const value = row[column];
  if (typeof value !== "number") {
    throw new Error(`Expected ${column} to be numeric in the database`);
  }
  return value;
}

export class SubscriptionRepository {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.ensureSchema();
  }

  ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        state TEXT NOT NULL,
        payment_method_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        trial_days INTEGER NOT NULL,
        price_cents INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payment_events (
        event_id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        processed_at TEXT NOT NULL
      );
    `);
  }

  createSubscription(subscription: Subscription): void {
    this.db.prepare(`
      INSERT INTO subscriptions (
        id, customer_id, plan, state, payment_method_id, created_at, trial_days, price_cents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      subscription.id,
      subscription.customerId,
      subscription.plan,
      subscription.state,
      subscription.paymentMethodId,
      subscription.createdAt,
      subscription.trialDays,
      subscription.priceCents,
    );
  }

  getSubscription(subscriptionId: string): Subscription | null {
    const row = this.db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(subscriptionId);
    if (!row) {
      return null;
    }
    const storedState = readString(row, "state");
    return new Subscription({
      id: readString(row, "id"),
      customerId: readString(row, "customer_id"),
      plan: readString(row, "plan"),
      paymentMethodId: readString(row, "payment_method_id"),
      state: subscriptionStates[storedState.toUpperCase()] ?? storedState as SubscriptionState,
      createdAt: readString(row, "created_at"),
      trialDays: readNumber(row, "trial_days"),
      priceCents: readNumber(row, "price_cents"),
    });
  }

  updateSubscription(subscription: Subscription): void {
    this.db.prepare(`
      UPDATE subscriptions
      SET state = ?, plan = ?, payment_method_id = ?, trial_days = ?, price_cents = ?
      WHERE id = ?
    `).run(
      subscription.state,
      subscription.plan,
      subscription.paymentMethodId,
      subscription.trialDays,
      subscription.priceCents,
      subscription.id,
    );
  }

  recordInvoice(invoice: Invoice): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO invoices (
        id, subscription_id, amount_cents, currency, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      invoice.id,
      invoice.subscriptionId,
      invoice.amountCents,
      invoice.currency,
      invoice.status,
      invoice.createdAt,
    );
  }

  getInvoice(invoiceId: string): Invoice | null {
    const row = this.db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId);
    if (!row) {
      return null;
    }
    return new Invoice({
      id: readString(row, "id"),
      subscriptionId: readString(row, "subscription_id"),
      amountCents: readNumber(row, "amount_cents"),
      currency: readString(row, "currency"),
      status: readString(row, "status"),
      createdAt: readString(row, "created_at"),
    });
  }

  getInvoices(subscriptionId: string): Invoice[] {
    return this.db.prepare(
      "SELECT * FROM invoices WHERE subscription_id = ? ORDER BY created_at ASC",
    ).all(subscriptionId).map((row) => new Invoice({
      id: readString(row, "id"),
      subscriptionId: readString(row, "subscription_id"),
      amountCents: readNumber(row, "amount_cents"),
      currency: readString(row, "currency"),
      status: readString(row, "status"),
      createdAt: readString(row, "created_at"),
    }));
  }

  eventExists(eventId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM payment_events WHERE event_id = ?").get(eventId));
  }

  recordPaymentEvent(event: PaymentEvent, payload: Record<string, unknown>): void {
    this.db.prepare(`
      INSERT INTO payment_events (
        event_id, subscription_id, event_type, invoice_id, amount_cents, currency, payload_json, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.subscriptionId,
      event.eventType,
      event.invoiceId,
      event.amountCents,
      event.currency,
      JSON.stringify(Object.fromEntries(
        Object.entries(payload).sort(([left], [right]) => left.localeCompare(right)),
      )),
      event.processedAt,
    );
  }

  getPaymentEvents(subscriptionId: string): PaymentEvent[] {
    return this.db.prepare(`
      SELECT * FROM payment_events WHERE subscription_id = ? ORDER BY processed_at ASC
    `).all(subscriptionId).map((row) => new PaymentEvent({
      eventId: readString(row, "event_id"),
      subscriptionId: readString(row, "subscription_id"),
      eventType: readString(row, "event_type"),
      invoiceId: readString(row, "invoice_id"),
      amountCents: readNumber(row, "amount_cents"),
      currency: readString(row, "currency"),
      processedAt: readString(row, "processed_at"),
    }));
  }

  close(): void {
    this.db.close();
  }
}
