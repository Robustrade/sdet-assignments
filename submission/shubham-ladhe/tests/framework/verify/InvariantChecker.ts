import { PlanCatalog, PlanPolicy } from '../../../src/domain/plans';
import { AuditEntry, ChargeAttempt, Invoice, Subscription, SubscriptionStatus } from '../../../src/domain/types';
import { auditHash, GENESIS_HASH, Repositories } from '../../../src/persistence/repositories';
import { ScriptedPaymentGateway } from '../doubles/ScriptedPaymentGateway';

/** The seven moves in the assignment's lifecycle diagram, written out independently of the service's table. */
const SPEC_TRANSITIONS = new Set([
  'trialing->active',
  'trialing->past_due',
  'trialing->canceled',
  'active->past_due',
  'active->canceled',
  'past_due->active',
  'past_due->canceled',
]);

/** Everything stored about one subscription, loaded once and shared by the per-subscription checks. */
interface SubscriptionView {
  subscription: Subscription;
  plan: PlanPolicy;
  invoices: Invoice[];
  attempts: ChargeAttempt[];
  audit: AuditEntry[];
  /** Prefix for messages, e.g. "sub_0001 (active)". */
  label: string;
}

/**
 * Business invariants that must hold across all tables (and the provider's ledger) at any
 * point in time. Runs after every test, so each scenario also proves the system as a whole is
 * still consistent - not only the thing that scenario asserts on.
 *
 * Reads go through the repositories (no ad-hoc SQL here). Each INV-n is one method below.
 */
export class InvariantChecker {
  constructor(
    private readonly repos: Repositories,
    private readonly plans: PlanCatalog,
    private readonly gateway: ScriptedPaymentGateway,
  ) {}

  violations(): string[] {
    const found: string[] = [];
    for (const subscription of this.repos.subscriptions.findAll()) {
      const view = this.load(subscription);
      found.push(
        ...this.activeHasSuccessfulPayment(view),
        ...this.canceledIsTerminal(view),
        ...this.pastDueHasFailedOpenInvoice(view),
        ...this.trialingWasNeverPaid(view),
        ...this.pricesAreConsistent(view),
        ...this.invoiceStatusMatchesAttempts(view),
        ...this.auditChainIsIntactAndLegal(view),
      );
    }
    found.push(...this.providerCallsMatchAttempts(), ...this.capturedMoneyIsAccountedFor(), ...this.noAttemptLeftPending());
    return found;
  }

  assertHolds(): void {
    const found = this.violations();
    if (found.length > 0) throw new Error(`Invariant violations:\n  - ${found.join('\n  - ')}`);
  }

  private load(subscription: Subscription): SubscriptionView {
    const invoices = this.repos.invoices.findBySubscription(subscription.id);
    return {
      subscription,
      plan: this.plans.get(subscription.plan),
      invoices,
      attempts: invoices.flatMap((invoice) => this.repos.attempts.findByInvoice(invoice.id)),
      audit: this.repos.audit.findBySubscription(subscription.id),
      label: `${subscription.id} (${subscription.status})`,
    };
  }

  /** INV-1: never active without a successful, persisted payment. */
  private activeHasSuccessfulPayment({ subscription, attempts, label }: SubscriptionView): string[] {
    const hasPayment = attempts.some((attempt) => attempt.status === 'succeeded');
    return subscription.status === 'active' && !hasPayment ? [`INV-1 ${label}: active without any successful charge attempt`] : [];
  }

  /** INV-2: canceled is terminal - no status change, attempt, provider call or open invoice afterwards. */
  private canceledIsTerminal({ subscription, invoices, attempts, audit, label }: SubscriptionView): string[] {
    if (subscription.status !== 'canceled') return [];
    const found: string[] = [];
    if (invoices.some((invoice) => invoice.status === 'open')) found.push(`INV-2 ${label}: canceled but still has an open invoice`);

    const cancellation = audit.find((entry) => entry.action === 'status_changed' && entry.toStatus === 'canceled');
    if (!cancellation) return [...found, `INV-2 ${label}: canceled but no audit entry for the cancellation`];

    if (audit.some((entry) => entry.seq > cancellation.seq && entry.action === 'status_changed')) {
      found.push(`INV-2 ${label}: status changed after cancellation`);
    }
    if (attempts.some((attempt) => attempt.createdAt > cancellation.at)) {
      found.push(`INV-2 ${label}: charge attempt created after cancellation`);
    }
    const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
    this.gateway.calls.forEach((call, index) => {
      const calledAt = this.gateway.callTimes[index] ?? '';
      if (invoiceIds.has(call.invoiceId) && calledAt > cancellation.at) {
        found.push(`INV-2 ${label}: provider called for ${call.invoiceId} after cancellation`);
      }
    });
    return found;
  }

  /** INV-3: past_due means there is an open invoice with at least one failure. */
  private pastDueHasFailedOpenInvoice({ subscription, invoices, label }: SubscriptionView): string[] {
    const hasFailedOpenInvoice = invoices.some((invoice) => invoice.status === 'open' && invoice.failedAttempts >= 1);
    return subscription.status === 'past_due' && !hasFailedOpenInvoice ? [`INV-3 ${label}: past_due without an open, failed invoice`] : [];
  }

  /** INV-4: trialing has never been paid. */
  private trialingWasNeverPaid({ subscription, invoices, label }: SubscriptionView): string[] {
    const hasPaidInvoice = invoices.some((invoice) => invoice.status === 'paid');
    return subscription.status === 'trialing' && hasPaidInvoice ? [`INV-4 ${label}: trialing but has a paid invoice`] : [];
  }

  /** INV-5: plan price = subscription price = invoice amount = attempt amount. */
  private pricesAreConsistent({ subscription, plan, invoices, attempts, label }: SubscriptionView): string[] {
    const found: string[] = [];
    if (subscription.priceCents !== plan.priceCents) {
      found.push(`INV-5 ${label}: price ${subscription.priceCents} != plan ${plan.priceCents}`);
    }
    for (const invoice of invoices) {
      if (invoice.amountCents !== subscription.priceCents) {
        found.push(`INV-5 ${invoice.id}: amount ${invoice.amountCents} != subscription price ${subscription.priceCents}`);
      }
    }
    for (const attempt of attempts) {
      const invoice = invoices.find((candidate) => candidate.id === attempt.invoiceId);
      if (invoice && attempt.amountCents !== invoice.amountCents) found.push(`INV-5 ${attempt.id}: attempt amount differs from invoice`);
    }
    return found;
  }

  /** INV-6: invoice status agrees with its attempts; never paid twice; uncollectible only after the full budget. */
  private invoiceStatusMatchesAttempts({ plan, invoices, attempts }: SubscriptionView): string[] {
    const found: string[] = [];
    for (const invoice of invoices) {
      const invoiceAttempts = attempts.filter((attempt) => attempt.invoiceId === invoice.id);
      const succeeded = invoiceAttempts.filter((attempt) => attempt.status === 'succeeded').length;
      const declined = invoiceAttempts.filter((attempt) => attempt.status === 'declined').length;
      const isPaid = invoice.status === 'paid' || invoice.status === 'refunded';

      if (succeeded > 1) found.push(`INV-6 ${invoice.id}: paid more than once (${succeeded} successful attempts)`);
      if (isPaid && succeeded !== 1) found.push(`INV-6 ${invoice.id}: ${invoice.status} but has ${succeeded} successful attempts`);
      if ((invoice.status === 'open' || invoice.status === 'uncollectible') && succeeded > 0) {
        found.push(`INV-6 ${invoice.id}: ${invoice.status} but has a successful attempt`);
      }
      // A void invoice stopped counting failures when it was closed; the counter only matters while collectable.
      if (invoice.status !== 'void' && invoice.failedAttempts !== declined) {
        found.push(`INV-6 ${invoice.id}: failed_attempts=${invoice.failedAttempts} but ${declined} declined attempts`);
      }
      if (invoice.status === 'uncollectible' && invoice.failedAttempts < plan.maxAttempts) {
        found.push(`INV-6 ${invoice.id}: uncollectible before the retry budget (${plan.maxAttempts}) was spent`);
      }
    }
    return found;
  }

  /**
   * INV-7: the audit log is a gap-free, untampered hash chain that replays to the current status.
   * INV-11: every recorded transition is one of the seven in the spec.
   */
  private auditChainIsIntactAndLegal({ subscription, audit, label }: SubscriptionView): string[] {
    const found: string[] = [];
    let expectedPrevHash = GENESIS_HASH;
    let replayedStatus: SubscriptionStatus | null = null;

    audit.forEach((entry, index) => {
      if (entry.seq !== index + 1) found.push(`INV-7 ${label}: audit seq gap at ${entry.seq}`);
      if (entry.prevHash !== expectedPrevHash || entry.hash !== auditHash(expectedPrevHash, entry)) {
        found.push(`INV-7 ${label}: audit hash chain broken at seq ${entry.seq}`);
      }
      expectedPrevHash = entry.hash;

      if (entry.action === 'created') replayedStatus = entry.toStatus;
      if (entry.action === 'status_changed') {
        if (!SPEC_TRANSITIONS.has(`${entry.fromStatus}->${entry.toStatus}`)) {
          found.push(`INV-11 ${label}: illegal transition ${entry.fromStatus} -> ${entry.toStatus} recorded at seq ${entry.seq}`);
        }
        if (entry.fromStatus !== replayedStatus) {
          found.push(`INV-7 ${label}: audit seq ${entry.seq} moves from ${entry.fromStatus} but status was ${replayedStatus}`);
        }
        replayedStatus = entry.toStatus;
      }
    });

    if (audit[0]?.action !== 'created') found.push(`INV-7 ${label}: audit does not start with 'created'`);
    if (replayedStatus !== subscription.status) found.push(`INV-7 ${label}: audit replays to ${replayedStatus}, row says ${subscription.status}`);
    return found;
  }

  /** INV-8: every provider call maps to a persisted attempt with the same amount; captured money is never on a "declined" attempt. */
  private providerCallsMatchAttempts(): string[] {
    const found: string[] = [];
    const attemptsByKey = new Map(this.repos.attempts.findAll().map((attempt) => [attempt.idempotencyKey, attempt]));

    for (const call of this.gateway.calls) {
      const attempt = attemptsByKey.get(call.idempotencyKey);
      if (!attempt) found.push(`INV-8 provider was called with key ${call.idempotencyKey} that has no persisted attempt`);
      else if (attempt.amountCents !== call.amountCents) {
        found.push(`INV-8 ${attempt.id}: provider charged ${call.amountCents}, attempt says ${attempt.amountCents}`);
      }
    }
    for (const capture of this.gateway.capturedCharges()) {
      const attempt = attemptsByKey.get(capture.idempotencyKey);
      if (attempt?.status === 'declined') found.push(`INV-8 ${attempt.id}: provider captured money but attempt is recorded as declined`);
    }
    return found;
  }

  /** INV-9: money taken is either on a paid/refunded invoice or explicitly flagged for refund. */
  private capturedMoneyIsAccountedFor(): string[] {
    const flaggedForRefund = new Set(
      this.repos.audit.findAll().filter((entry) => entry.action === 'charge_requires_refund').map((entry) => entry.reference),
    );
    const found: string[] = [];
    for (const attempt of this.repos.attempts.findAll()) {
      if (attempt.status !== 'succeeded') continue;
      const invoice = this.repos.invoices.findById(attempt.invoiceId);
      const onPaidInvoice = invoice?.status === 'paid' || invoice?.status === 'refunded';
      if (invoice && !onPaidInvoice && !flaggedForRefund.has(attempt.id)) {
        found.push(`INV-9 ${attempt.id}: successful charge on ${invoice.status} invoice ${invoice.id} with no refund flagged`);
      }
    }
    return found;
  }

  /** INV-10: at rest (no request in flight) no attempt is stuck in 'pending'. */
  private noAttemptLeftPending(): string[] {
    return this.repos.attempts
      .findAll()
      .filter((attempt) => attempt.status === 'pending')
      .map((attempt) => `INV-10 ${attempt.id}: attempt left pending with nothing in flight`);
  }
}
