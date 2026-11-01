import { LifecycleEvent, nextStatus, Status } from './stateMachine';

export interface Customer { id: string; paymentMethods: string[] }

export interface Subscription {
  id: string;
  customerId: string;
  plan: string;
  status: Status;
  paymentMethodId: string;
  trialEndsAt: string;
  failedPayments: number; // failures in a row (resets on success)
  createdAt: string;
  canceledAt: string | null;
}

export type InvoiceStatus = 'pending' | 'paid' | 'failed' | 'refunded';

// One invoice per billing attempt.
export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  attempt: number;
  idempotencyKey: string;
  note: string | null; // decline reason or 'provider_timeout'
}

export interface WebhookEventRow {
  eventId: string;
  type: string;
  invoiceId: string;
  result: 'applied' | 'ignored';
  reason: string | null;
  timesReceived: number;
}

export interface AuditRow { subscriptionId: string; event: string; from: Status | null; to: Status | null; at: string }

// An "email to send"
export interface OutboxRow { subscriptionId: string; message: string }

const copy = <T>(x: T): T => structuredClone(x);


export class Database {
  private customers = new Map<string, Customer>();
  private subscriptions = new Map<string, Subscription>();
  private invoices = new Map<string, Invoice>();
  private webhookEvents = new Map<string, WebhookEventRow>();
  private auditLog: AuditRow[] = [];
  private outboxRows: OutboxRow[] = [];
  private counter = 0;

  newId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_${String(this.counter).padStart(3, '0')}`;
  }

  // ---- customers ----
  addCustomer(c: Customer): void { this.customers.set(c.id, copy(c)); }
  getCustomer(id: string): Customer | undefined { return copy(this.customers.get(id)); }

  // ---- subscriptions ----
  addSubscription(s: Subscription): void {
    this.subscriptions.set(s.id, copy(s));
    this.audit(s.id, 'CREATED', null, s.status, s.createdAt);
  }
  getSubscription(id: string): Subscription | undefined { return copy(this.subscriptions.get(id)); }
  allSubscriptions(): Subscription[] { return [...this.subscriptions.values()].map(copy); }

  // The ONLY way to change a status. Illegal moves throw. Every change is audited.
  applyEvent(subscriptionId: string, event: LifecycleEvent, at: string): { from: Status; to: Status } {
    const sub = this.subscriptions.get(subscriptionId)!;
    const from = sub.status;
    const to = nextStatus(from, event);
    sub.status = to;
    if (to === 'canceled') sub.canceledAt = at;
    this.audit(subscriptionId, event, from, to, at);
    if (from !== to) this.outboxRows.push({ subscriptionId, message: `status changed to ${to}` });
    return { from, to };
  }

  setFailedPayments(subscriptionId: string, n: number): void { this.subscriptions.get(subscriptionId)!.failedPayments = n; }

  // ---- invoices ----
  addInvoice(inv: Invoice): void {
    if ([...this.invoices.values()].some((i) => i.idempotencyKey === inv.idempotencyKey)) {
      throw new Error(`Duplicate idempotency key ${inv.idempotencyKey}`);
    }
    this.invoices.set(inv.id, copy(inv));
  }
  getInvoice(id: string): Invoice | undefined { return copy(this.invoices.get(id)); }
  updateInvoice(id: string, changes: Partial<Pick<Invoice, 'status' | 'note'>>): void {
    Object.assign(this.invoices.get(id)!, changes);
  }
  invoicesOf(subscriptionId: string): Invoice[] {
    return [...this.invoices.values()].filter((i) => i.subscriptionId === subscriptionId).map(copy);
  }

  // ---- webhook events ----
  getWebhookEvent(eventId: string): WebhookEventRow | undefined { return copy(this.webhookEvents.get(eventId)); }
  addWebhookEvent(row: WebhookEventRow): void {
    if (this.webhookEvents.has(row.eventId)) throw new Error(`Duplicate event ${row.eventId}`);
    this.webhookEvents.set(row.eventId, copy(row));
  }
  countRepeat(eventId: string): void { this.webhookEvents.get(eventId)!.timesReceived += 1; }

  // ---- audit + outbox ----
  audit(subscriptionId: string, event: string, from: Status | null, to: Status | null, at: string): void {
    this.auditLog.push({ subscriptionId, event, from, to, at });
  }
  auditOf(subscriptionId: string): AuditRow[] { return this.auditLog.filter((a) => a.subscriptionId === subscriptionId).map(copy); }
  outboxOf(subscriptionId: string): OutboxRow[] { return this.outboxRows.filter((o) => o.subscriptionId === subscriptionId).map(copy); }

  /** Test-only: break data on purpose to prove the invariant check can catch it. */
  corruptForTest(invoiceId: string, status: InvoiceStatus): void { this.invoices.get(invoiceId)!.status = status; }
}
