import { createHash } from 'crypto';
import { ApprovedTransition, isApprovedTransition } from '../domain/lifecycle';
import { InvoiceEvent, InvoiceLifecycle } from '../domain/invoiceLifecycle';
import {
  AttemptStatus,
  AuditEntry,
  ChangeSource,
  ChargeAttempt,
  Customer,
  Invoice,
  Notification,
  PaymentMethod,
  Subscription,
  SubscriptionStatus,
  WebhookEventRecord,
} from '../domain/types';
import { Row, SqlDatabase } from './SqlDatabase';

/** A compare-and-set write found the row in a different state than expected. */
export class StaleWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleWriteError';
  }
}

const str = (v: unknown): string => String(v);
const optStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);

// ---------------------------------------------------------------------------

export class CustomerRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(customer: Customer): void {
    this.db.run('INSERT INTO customers (id, email, created_at) VALUES (?, ?, ?)', [
      customer.id,
      customer.email,
      customer.createdAt,
    ]);
  }

  insertPaymentMethod(pm: PaymentMethod): void {
    this.db.run('INSERT INTO payment_methods (id, customer_id, brand, last4, status) VALUES (?, ?, ?, ?, ?)', [
      pm.id,
      pm.customerId,
      pm.brand,
      pm.last4,
      pm.status,
    ]);
  }

  findById(id: string): Customer | undefined {
    const r = this.db.get('SELECT * FROM customers WHERE id = ?', [id]);
    return r && { id: str(r.id), email: str(r.email), createdAt: str(r.created_at) };
  }

  findPaymentMethod(id: string): PaymentMethod | undefined {
    const r = this.db.get('SELECT * FROM payment_methods WHERE id = ?', [id]);
    return (
      r && {
        id: str(r.id),
        customerId: str(r.customer_id),
        brand: str(r.brand),
        last4: str(r.last4),
        status: str(r.status) as PaymentMethod['status'],
      }
    );
  }
}

// ---------------------------------------------------------------------------

function toSubscription(r: Row): Subscription {
  return {
    id: str(r.id),
    customerId: str(r.customer_id),
    plan: str(r.plan) as Subscription['plan'],
    status: str(r.status) as SubscriptionStatus,
    paymentMethodId: str(r.payment_method_id),
    priceCents: num(r.price_cents),
    currency: str(r.currency),
    trialEndsAt: optStr(r.trial_ends_at),
    currentPeriodStart: str(r.current_period_start),
    currentPeriodEnd: str(r.current_period_end),
    canceledAt: optStr(r.canceled_at),
    cancelReason: optStr(r.cancel_reason),
    version: num(r.version),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export class SubscriptionRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** New subscriptions always start in `trialing` (a no-trial plan simply has a zero-length trial). */
  insert(sub: Omit<Subscription, 'status' | 'version' | 'canceledAt' | 'cancelReason'>): void {
    this.db.run(
      `INSERT INTO subscriptions (id, customer_id, plan, status, payment_method_id, price_cents, currency,
         trial_ends_at, current_period_start, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, 'trialing', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sub.id,
        sub.customerId,
        sub.plan,
        sub.paymentMethodId,
        sub.priceCents,
        sub.currency,
        sub.trialEndsAt,
        sub.currentPeriodStart,
        sub.currentPeriodEnd,
        sub.createdAt,
        sub.updatedAt,
      ],
    );
  }

  findById(id: string): Subscription | undefined {
    const r = this.db.get('SELECT * FROM subscriptions WHERE id = ?', [id]);
    return r && toSubscription(r);
  }

  findAll(): Subscription[] {
    return this.db.all('SELECT * FROM subscriptions ORDER BY id').map(toSubscription);
  }

  findByStatus(status: SubscriptionStatus): Subscription[] {
    return this.db.all('SELECT * FROM subscriptions WHERE status = ? ORDER BY id', [status]).map(toSubscription);
  }

  /**
   * The only way to change a subscription's status. Requires a transition approved by the
   * lifecycle, and only applies if the row is still in the `from` state (compare-and-set).
   */
  applyTransition(t: ApprovedTransition, at: string, cancelReason?: string): void {
    if (!isApprovedTransition(t)) throw new Error('Status changes must come from SubscriptionLifecycle.decide()');
    const canceling = t.to === 'canceled';
    const changed = this.db.run(
      `UPDATE subscriptions
          SET status = ?, version = version + 1, updated_at = ?,
              canceled_at = CASE WHEN ? THEN ? ELSE canceled_at END,
              cancel_reason = CASE WHEN ? THEN ? ELSE cancel_reason END
        WHERE id = ? AND status = ?`,
      [t.to, at, canceling ? 1 : 0, at, canceling ? 1 : 0, cancelReason ?? null, t.subscriptionId, t.from],
    );
    if (changed !== 1) throw new StaleWriteError(`Subscription ${t.subscriptionId} is no longer ${t.from}`);
  }

  updatePeriod(id: string, start: string, end: string, at: string): void {
    this.db.run(
      'UPDATE subscriptions SET current_period_start = ?, current_period_end = ?, version = version + 1, updated_at = ? WHERE id = ?',
      [start, end, at, id],
    );
  }
}

// ---------------------------------------------------------------------------

function toInvoice(r: Row): Invoice {
  return {
    id: str(r.id),
    subscriptionId: str(r.subscription_id),
    amountCents: num(r.amount_cents),
    currency: str(r.currency),
    status: str(r.status) as Invoice['status'],
    periodStart: str(r.period_start),
    periodEnd: str(r.period_end),
    failedAttempts: num(r.failed_attempts),
    nextRetryAt: optStr(r.next_retry_at),
    paidAt: optStr(r.paid_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export class InvoiceRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(inv: Pick<Invoice, 'id' | 'subscriptionId' | 'amountCents' | 'currency' | 'periodStart' | 'periodEnd' | 'createdAt'>): void {
    this.db.run(
      `INSERT INTO invoices (id, subscription_id, amount_cents, currency, status, period_start, period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [inv.id, inv.subscriptionId, inv.amountCents, inv.currency, inv.periodStart, inv.periodEnd, inv.createdAt, inv.createdAt],
    );
  }

  findById(id: string): Invoice | undefined {
    const r = this.db.get('SELECT * FROM invoices WHERE id = ?', [id]);
    return r && toInvoice(r);
  }

  findBySubscription(subscriptionId: string): Invoice[] {
    return this.db
      .all('SELECT * FROM invoices WHERE subscription_id = ? ORDER BY period_start, id', [subscriptionId])
      .map(toInvoice);
  }

  findOpenForSubscription(subscriptionId: string): Invoice | undefined {
    const r = this.db.get("SELECT * FROM invoices WHERE subscription_id = ? AND status = 'open'", [subscriptionId]);
    return r && toInvoice(r);
  }

  findAll(): Invoice[] {
    return this.db.all('SELECT * FROM invoices ORDER BY id').map(toInvoice);
  }

  /** Moves an invoice through its own lifecycle; refuses moves the invoice lifecycle doesn't allow. */
  transition(id: string, event: InvoiceEvent, at: string): void {
    const current = this.findById(id);
    if (!current) throw new Error(`Invoice ${id} not found`);
    const next = InvoiceLifecycle.next(current.status, event);
    if (!next) throw new StaleWriteError(`Invoice ${id} cannot go from ${current.status} via ${event}`);
    const paidAt = event === 'paid' ? at : current.paidAt;
    const changed = this.db.run(
      'UPDATE invoices SET status = ?, paid_at = ?, next_retry_at = NULL, updated_at = ? WHERE id = ? AND status = ?',
      [next, paidAt, at, id, current.status],
    );
    if (changed !== 1) throw new StaleWriteError(`Invoice ${id} changed concurrently`);
  }

  recordFailure(id: string, failedAttempts: number, nextRetryAt: string | null, at: string): void {
    this.db.run(
      "UPDATE invoices SET failed_attempts = ?, next_retry_at = ?, updated_at = ? WHERE id = ? AND status = 'open'",
      [failedAttempts, nextRetryAt, at, id],
    );
  }

  /** Open invoices whose scheduled retry time has passed. */
  findDueForRetry(now: string): Invoice[] {
    return this.db
      .all("SELECT * FROM invoices WHERE status = 'open' AND next_retry_at IS NOT NULL AND next_retry_at <= ? ORDER BY id", [now])
      .map(toInvoice);
  }
}

// ---------------------------------------------------------------------------

function toAttempt(r: Row): ChargeAttempt {
  return {
    id: str(r.id),
    invoiceId: str(r.invoice_id),
    attemptNo: num(r.attempt_no),
    idempotencyKey: str(r.idempotency_key),
    amountCents: num(r.amount_cents),
    status: str(r.status) as AttemptStatus,
    providerChargeId: optStr(r.provider_charge_id),
    failureReason: optStr(r.failure_reason),
    createdAt: str(r.created_at),
    settledAt: optStr(r.settled_at),
  };
}

export class ChargeAttemptRepository {
  constructor(private readonly db: SqlDatabase) {}

  insert(a: Pick<ChargeAttempt, 'id' | 'invoiceId' | 'attemptNo' | 'idempotencyKey' | 'amountCents' | 'createdAt'> & {
    status?: AttemptStatus;
    providerChargeId?: string | null;
  }): void {
    this.db.run(
      `INSERT INTO charge_attempts (id, invoice_id, attempt_no, idempotency_key, amount_cents, status, provider_charge_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [a.id, a.invoiceId, a.attemptNo, a.idempotencyKey, a.amountCents, a.status ?? 'pending', a.providerChargeId ?? null, a.createdAt],
    );
  }

  findById(id: string): ChargeAttempt | undefined {
    const r = this.db.get('SELECT * FROM charge_attempts WHERE id = ?', [id]);
    return r && toAttempt(r);
  }

  findByInvoice(invoiceId: string): ChargeAttempt[] {
    return this.db.all('SELECT * FROM charge_attempts WHERE invoice_id = ? ORDER BY attempt_no', [invoiceId]).map(toAttempt);
  }

  findByProviderChargeId(chargeId: string): ChargeAttempt | undefined {
    const r = this.db.get('SELECT * FROM charge_attempts WHERE provider_charge_id = ?', [chargeId]);
    return r && toAttempt(r);
  }

  findUnresolved(): ChargeAttempt[] {
    return this.db.all("SELECT * FROM charge_attempts WHERE status = 'unknown' ORDER BY id").map(toAttempt);
  }

  findAll(): ChargeAttempt[] {
    return this.db.all('SELECT * FROM charge_attempts ORDER BY id').map(toAttempt);
  }

  /** Settle a pending/unknown attempt. Returns false if it was already settled. */
  settle(id: string, status: 'succeeded' | 'declined', providerChargeId: string | null, reason: string | null, at: string): boolean {
    const changed = this.db.run(
      `UPDATE charge_attempts
          SET status = ?, provider_charge_id = COALESCE(provider_charge_id, ?), failure_reason = ?, settled_at = ?
        WHERE id = ? AND status IN ('pending', 'unknown')`,
      [status, providerChargeId, reason, at, id],
    );
    return changed === 1;
  }

  markUnknown(id: string): void {
    this.db.run("UPDATE charge_attempts SET status = 'unknown' WHERE id = ? AND status = 'pending'", [id]);
  }

  /** Put an unknown attempt back to pending while it is being re-sent (guards against a second concurrent re-send). */
  claimForResend(id: string): boolean {
    return this.db.run("UPDATE charge_attempts SET status = 'pending' WHERE id = ? AND status = 'unknown'", [id]) === 1;
  }
}

// ---------------------------------------------------------------------------

function toWebhookEvent(r: Row): WebhookEventRecord {
  return {
    eventId: str(r.event_id),
    type: str(r.type) as WebhookEventRecord['type'],
    subscriptionId: str(r.subscription_id),
    invoiceId: str(r.invoice_id),
    payload: str(r.payload),
    outcome: str(r.outcome) as WebhookEventRecord['outcome'],
    reason: optStr(r.reason),
    receivedAt: str(r.received_at),
  };
}

export class WebhookEventRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** Throws a UNIQUE violation if the event id was already recorded. */
  insert(e: WebhookEventRecord): void {
    this.db.run(
      `INSERT INTO webhook_events (event_id, type, subscription_id, invoice_id, payload, outcome, reason, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.eventId, e.type, e.subscriptionId, e.invoiceId, e.payload, e.outcome, e.reason, e.receivedAt],
    );
  }

  findById(eventId: string): WebhookEventRecord | undefined {
    const r = this.db.get('SELECT * FROM webhook_events WHERE event_id = ?', [eventId]);
    return r && toWebhookEvent(r);
  }

  findBySubscription(subscriptionId: string): WebhookEventRecord[] {
    return this.db
      .all('SELECT * FROM webhook_events WHERE subscription_id = ? ORDER BY received_at, event_id', [subscriptionId])
      .map(toWebhookEvent);
  }

  findAll(): WebhookEventRecord[] {
    return this.db.all('SELECT * FROM webhook_events ORDER BY received_at, event_id').map(toWebhookEvent);
  }
}

// ---------------------------------------------------------------------------

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditInput {
  subscriptionId: string;
  action: string;
  fromStatus?: SubscriptionStatus | null;
  toStatus?: SubscriptionStatus | null;
  source: ChangeSource;
  reference?: string | null;
  at: string;
}

/** Fields that are covered by the hash. Exported so verifiers can recompute it. */
export function auditHash(prevHash: string, e: Omit<AuditEntry, 'id' | 'hash' | 'prevHash'>): string {
  const body = JSON.stringify([e.subscriptionId, e.seq, e.action, e.fromStatus, e.toStatus, e.source, e.reference, e.at]);
  return createHash('sha256').update(prevHash).update(body).digest('hex');
}

function toAudit(r: Row): AuditEntry {
  return {
    id: num(r.id),
    subscriptionId: str(r.subscription_id),
    seq: num(r.seq),
    action: str(r.action),
    fromStatus: optStr(r.from_status) as SubscriptionStatus | null,
    toStatus: optStr(r.to_status) as SubscriptionStatus | null,
    source: str(r.source) as ChangeSource,
    reference: optStr(r.reference),
    at: str(r.at),
    prevHash: str(r.prev_hash),
    hash: str(r.hash),
  };
}

/** Append-only, per-subscription hash chain: editing or deleting an entry breaks every hash after it. */
export class AuditLogRepository {
  constructor(private readonly db: SqlDatabase) {}

  append(input: AuditInput): AuditEntry {
    const last = this.db.get('SELECT seq, hash FROM audit_log WHERE subscription_id = ? ORDER BY seq DESC LIMIT 1', [
      input.subscriptionId,
    ]);
    const seq = last ? num(last.seq) + 1 : 1;
    const prevHash = last ? str(last.hash) : GENESIS_HASH;
    const entry = {
      subscriptionId: input.subscriptionId,
      seq,
      action: input.action,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      source: input.source,
      reference: input.reference ?? null,
      at: input.at,
    };
    const hash = auditHash(prevHash, entry);
    this.db.run(
      `INSERT INTO audit_log (subscription_id, seq, action, from_status, to_status, source, reference, at, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entry.subscriptionId, seq, entry.action, entry.fromStatus, entry.toStatus, entry.source, entry.reference, entry.at, prevHash, hash],
    );
    return { id: 0, ...entry, prevHash, hash };
  }

  findBySubscription(subscriptionId: string): AuditEntry[] {
    return this.db.all('SELECT * FROM audit_log WHERE subscription_id = ? ORDER BY seq', [subscriptionId]).map(toAudit);
  }

  findAll(): AuditEntry[] {
    return this.db.all('SELECT * FROM audit_log ORDER BY subscription_id, seq').map(toAudit);
  }
}

// ---------------------------------------------------------------------------

export class NotificationRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** Records a side effect at most once per (kind, reference). Returns true if it was new. */
  record(subscriptionId: string, kind: string, reference: string, at: string): boolean {
    return (
      this.db.run(
        'INSERT OR IGNORE INTO notifications (subscription_id, kind, reference, created_at) VALUES (?, ?, ?, ?)',
        [subscriptionId, kind, reference, at],
      ) === 1
    );
  }

  findBySubscription(subscriptionId: string): Notification[] {
    return this.db
      .all('SELECT * FROM notifications WHERE subscription_id = ? ORDER BY id', [subscriptionId])
      .map((r) => ({
        id: num(r.id),
        subscriptionId: str(r.subscription_id),
        kind: str(r.kind),
        reference: str(r.reference),
        createdAt: str(r.created_at),
      }));
  }
}

// ---------------------------------------------------------------------------

export interface StoredResponse {
  requestHash: string;
  status: number;
  body: unknown;
}

export class IdempotencyKeyRepository {
  constructor(private readonly db: SqlDatabase) {}

  find(key: string): StoredResponse | undefined {
    const r = this.db.get('SELECT * FROM idempotency_keys WHERE key = ?', [key]);
    return r && { requestHash: str(r.request_hash), status: num(r.response_status), body: JSON.parse(str(r.response_body)) };
  }

  save(key: string, requestHash: string, status: number, body: unknown, at: string): void {
    this.db.run('INSERT INTO idempotency_keys (key, request_hash, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?)', [
      key,
      requestHash,
      status,
      JSON.stringify(body),
      at,
    ]);
  }
}

// ---------------------------------------------------------------------------

/** All repositories over one database. */
export class Repositories {
  readonly customers: CustomerRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly invoices: InvoiceRepository;
  readonly attempts: ChargeAttemptRepository;
  readonly webhookEvents: WebhookEventRepository;
  readonly audit: AuditLogRepository;
  readonly notifications: NotificationRepository;
  readonly idempotencyKeys: IdempotencyKeyRepository;

  constructor(readonly db: SqlDatabase, overrides: Partial<Omit<Repositories, 'db'>> = {}) {
    this.customers = overrides.customers ?? new CustomerRepository(db);
    this.subscriptions = overrides.subscriptions ?? new SubscriptionRepository(db);
    this.invoices = overrides.invoices ?? new InvoiceRepository(db);
    this.attempts = overrides.attempts ?? new ChargeAttemptRepository(db);
    this.webhookEvents = overrides.webhookEvents ?? new WebhookEventRepository(db);
    this.audit = overrides.audit ?? new AuditLogRepository(db);
    this.notifications = overrides.notifications ?? new NotificationRepository(db);
    this.idempotencyKeys = overrides.idempotencyKeys ?? new IdempotencyKeyRepository(db);
  }
}
