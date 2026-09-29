import type { MockPaymentProvider } from '../doubles/MockPaymentProvider';
import type { DbInspector } from './DbInspector';

/** Plan prices from the assignment assumptions — an oracle independent of the service's PlanCatalog. */
const EXPECTED_PRICE: Record<string, { amount: number; currency: string }> = {
  basic: { amount: 1900, currency: 'USD' },
  pro: { amount: 4900, currency: 'USD' },
};

/**
 * System-wide business invariants (STRATEGY.md §6). TestEnvironment runs these after
 * every test, so every scenario — including ones added later — also proves them.
 * Returns human-readable violations rather than throwing, so one run reports all of them.
 */
export class InvariantChecker {
  constructor(
    private readonly db: DbInspector,
    private readonly provider: MockPaymentProvider,
  ) {}

  violations(): string[] {
    return [
      ...this.activeRequiresSucceededPayment(),
      ...this.canceledIsTerminal(),
      ...this.oneChargePerAttempt(),
      ...this.webhookAuditIntegrity(),
      ...this.auditChainIsUnbroken(),
      ...this.invoicesMatchPlanPrice(),
      ...this.noContradictoryPaymentRecords(),
    ];
  }

  /** INV-1 */
  private activeRequiresSucceededPayment(): string[] {
    return this.db
      .query<{ id: string }>(
        `SELECT s.id FROM subscriptions s WHERE s.status = 'active' AND NOT EXISTS (
           SELECT 1 FROM payment_attempts a JOIN invoices i ON i.id = a.invoice_id
           WHERE i.subscription_id = s.id AND a.status = 'succeeded')`,
      )
      .map((r) => `INV-1 ${r.id} is active without a succeeded payment attempt`);
  }

  /** INV-2 */
  private canceledIsTerminal(): string[] {
    const leftCanceled = this.db
      .query<{ subscription_id: string; to_status: string }>(
        `SELECT subscription_id, to_status FROM subscription_audit_log WHERE from_status = 'canceled'`,
      )
      .map((r) => `INV-2 ${r.subscription_id} left canceled (-> ${r.to_status})`);
    const canceledAtMismatch = this.db
      .query<{ id: string; status: string }>(
        `SELECT id, status FROM subscriptions
         WHERE (status = 'canceled') <> (canceled_at IS NOT NULL)`,
      )
      .map((r) => `INV-2 ${r.id} has status ${r.status} but canceled_at disagrees`);
    return [...leftCanceled, ...canceledAtMismatch];
  }

  /** INV-3 */
  private oneChargePerAttempt(): string[] {
    const out: string[] = [];
    const attempts = this.db.count('payment_attempts');
    if (this.provider.calls.length !== attempts) {
      out.push(`INV-3 provider was charged ${this.provider.calls.length} times but ${attempts} payment attempts are persisted`);
    }
    const keys = this.provider.calls.map((c) => c.idempotencyKey);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length > 0) out.push(`INV-3 provider charged the same idempotency key more than once: ${dupes.join(', ')}`);
    return out;
  }

  /** INV-4 */
  private webhookAuditIntegrity(): string[] {
    return this.db
      .query<{ reference: string; n: number; outcome: string | null }>(
        `SELECT a.reference, COUNT(*) AS n, w.outcome FROM subscription_audit_log a
         LEFT JOIN webhook_events w ON w.event_id = a.reference
         WHERE a.source = 'webhook' GROUP BY a.reference`,
      )
      .filter((r) => r.n !== 1 || r.outcome !== 'applied')
      .map((r) => `INV-4 webhook ${r.reference} produced ${r.n} audit entries with event outcome ${r.outcome ?? 'missing'}`);
  }

  /** INV-5 */
  private auditChainIsUnbroken(): string[] {
    const out: string[] = [];
    for (const sub of this.db.subscriptions()) {
      const log = this.db.auditLog(sub.id);
      if (log[0]?.from_status !== null) out.push(`INV-5 ${sub.id} audit log does not start at creation`);
      log.slice(1).forEach((entry, i) => {
        if (entry.from_status !== log[i]!.to_status) {
          out.push(`INV-5 ${sub.id} audit gap: ${log[i]!.to_status} then ${entry.from_status}->${entry.to_status}`);
        }
      });
      if (log.at(-1)?.to_status !== sub.status) {
        out.push(`INV-5 ${sub.id} is ${sub.status} but audit log ends at ${log.at(-1)?.to_status}`);
      }
    }
    return out;
  }

  /** INV-6 */
  private invoicesMatchPlanPrice(): string[] {
    return this.db
      .query<{ id: string; plan: string; amount: number; currency: string }>(
        `SELECT i.id, s.plan, i.amount, i.currency FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id`,
      )
      .filter((r) => EXPECTED_PRICE[r.plan]?.amount !== r.amount || EXPECTED_PRICE[r.plan]?.currency !== r.currency)
      .map((r) => `INV-6 invoice ${r.id} is ${r.amount} ${r.currency}, plan ${r.plan} expects ${JSON.stringify(EXPECTED_PRICE[r.plan])}`);
  }

  /** INV-7 */
  private noContradictoryPaymentRecords(): string[] {
    const paidNeedsOneSuccess = this.db
      .query<{ id: string; status: string; successes: number }>(
        `SELECT i.id, i.status, (SELECT COUNT(*) FROM payment_attempts a
           WHERE a.invoice_id = i.id AND a.status = 'succeeded') AS successes
         FROM invoices i`,
      )
      .filter((r) => (r.status === 'paid' || r.status === 'refunded' ? r.successes !== 1 : r.successes !== 0))
      .map((r) => `INV-7 invoice ${r.id} is ${r.status} with ${r.successes} succeeded attempts`);
    const pastDueNeedsFailure = this.db
      .query<{ id: string }>(
        `SELECT s.id FROM subscriptions s WHERE s.status = 'past_due' AND NOT EXISTS (
           SELECT 1 FROM payment_attempts a JOIN invoices i ON i.id = a.invoice_id
           WHERE i.subscription_id = s.id AND a.status = 'failed')`,
      )
      .map((r) => `INV-7 ${r.id} is past_due without any failed payment attempt`);
    const multiplePending = this.db
      .query<{ invoice_id: string; n: number }>(
        `SELECT invoice_id, COUNT(*) AS n FROM payment_attempts WHERE status = 'pending' GROUP BY invoice_id HAVING n > 1`,
      )
      .map((r) => `INV-7 invoice ${r.invoice_id} has ${r.n} charges in flight at once`);
    return [...paidNeedsOneSuccess, ...pastDueNeedsFailure, ...multiplePending];
  }
}
