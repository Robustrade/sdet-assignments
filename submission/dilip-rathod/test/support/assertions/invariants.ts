import { PlanCatalog } from '../../../src/plans/PlanPolicy';
import type { ChargeRequest } from '../../../src/payments/PaymentProvider';
import type { PersistenceInspector, SubscriptionRow } from '../persistence/PersistenceInspector';

export interface InvariantContext {
  db: PersistenceInspector;
  providerRequests: ChargeRequest[];
}

/** A named business rule over the whole persisted state. Returns human-readable violations. */
export interface Invariant {
  readonly name: string;
  check(ctx: InvariantContext): string[];
}

const plans = PlanCatalog.default();

const perSubscription = (name: string, rule: (s: SubscriptionRow, ctx: InvariantContext) => string | undefined): Invariant => ({
  name,
  check: (ctx) => ctx.db.subscriptions().flatMap((s) => {
    const violation = rule(s, ctx);
    return violation ? [`${s.id} (${s.status}): ${violation}`] : [];
  }),
});

export const INVARIANTS: Invariant[] = [
  perSubscription('active subscriptions have a successful, persisted payment', (s, { db }) => {
    if (s.status !== 'active') return;
    const paid = db.invoicesFor(s.id).filter((i) => i.status === 'paid' || i.status === 'refunded');
    const succeeded = paid.flatMap((i) => db.attemptsFor(i.id)).filter((a) => a.status === 'succeeded');
    return succeeded.length === 0 ? 'no succeeded attempt on a paid invoice' : undefined;
  }),

  perSubscription('canceled subscriptions are inert', (s, { db }) => {
    if (s.status !== 'canceled') return;
    if (!s.canceled_at) return 'canceled_at missing';
    if (s.next_billing_at) return 'still scheduled for billing';
    if (db.invoicesFor(s.id).some((i) => i.status === 'open')) return 'has an open invoice';
  }),

  perSubscription('past_due subscriptions have exactly one open invoice', (s, { db }) => {
    if (s.status !== 'past_due') return;
    const open = db.invoicesFor(s.id).filter((i) => i.status === 'open').length;
    return open !== 1 ? `${open} open invoices` : undefined;
  }),

  {
    name: 'no invoice is collected twice',
    check: ({ db }) =>
      db.invoices().flatMap((i) => {
        const succeeded = db.attemptsFor(i.id).filter((a) => a.status === 'succeeded').length;
        if (succeeded > 1) return [`${i.id}: ${succeeded} succeeded attempts`];
        if ((i.status === 'paid' || i.status === 'refunded') && succeeded !== 1) return [`${i.id} is ${i.status} with ${succeeded} succeeded attempts`];
        return [];
      }),
  },

  {
    name: 'every provider charge maps to exactly one attempt row, and vice versa',
    check: ({ db, providerRequests }) => {
      const violations: string[] = [];
      const attempts = db.attempts();
      const keys = providerRequests.map((r) => r.idempotencyKey);
      if (new Set(keys).size !== keys.length) violations.push(`idempotency key reused across provider calls: ${keys.join(', ')}`);
      if (attempts.length !== providerRequests.length) violations.push(`${attempts.length} attempts but ${providerRequests.length} provider calls`);
      for (const request of providerRequests) {
        const attempt = attempts.find((a) => a.idempotency_key === request.idempotencyKey);
        if (!attempt) violations.push(`provider call ${request.idempotencyKey} has no attempt row`);
        else if (attempt.amount !== request.amount || attempt.invoice_id !== request.reference) {
          violations.push(`provider call ${request.idempotencyKey} disagrees with its attempt row`);
        }
      }
      return violations;
    },
  },

  {
    name: 'amounts follow plan prices',
    check: ({ db }) =>
      db.invoices().flatMap((i) => {
        const v: string[] = [];
        const plan = plans.find(i.plan);
        if (!plan || plan.priceCents !== i.amount || plan.currency !== i.currency) v.push(`${i.id}: ${i.amount} ${i.currency} does not match plan ${i.plan}`);
        for (const a of db.attemptsFor(i.id)) if (a.amount !== i.amount) v.push(`${a.id}: attempt amount ${a.amount} != invoice ${i.amount}`);
        return v;
      }),
  },

  perSubscription('audit trail is a coherent chain ending at the current status', (s, { db }) => {
    const trail = db.auditTrail(s.id);
    if (trail[0]?.event_type !== 'created' || trail[0].to_status !== 'trialing') return 'trail does not start with created -> trialing';
    let status = 'trialing';
    for (const entry of trail.slice(1)) {
      if (entry.from_status !== status) return `entry #${entry.seq} starts at ${entry.from_status}, expected ${status}`;
      status = entry.to_status ?? status;
    }
    return status !== s.status ? `trail ends at ${status}` : undefined;
  }),

  {
    name: 'each webhook event has exactly one processing delivery',
    check: ({ db }) => {
      const v: string[] = [];
      for (const e of db.webhookEvents()) {
        const firsts = db.deliveriesFor(e.event_id).filter((d) => d.is_duplicate === 0).length;
        if (firsts !== 1) v.push(`${e.event_id}: ${firsts} non-duplicate deliveries`);
      }
      return v;
    },
  },

  {
    name: 'timestamps are coherent',
    check: ({ db }) => {
      const v: string[] = [];
      for (const s of db.subscriptions()) {
        if (s.updated_at < s.created_at) v.push(`${s.id}: updated_at before created_at`);
        if (s.canceled_at && s.canceled_at < s.created_at) v.push(`${s.id}: canceled before created`);
        if (s.current_period_start && s.current_period_end && s.current_period_end <= s.current_period_start) v.push(`${s.id}: empty period`);
      }
      for (const i of db.invoices()) {
        if (i.paid_at && i.paid_at < i.created_at) v.push(`${i.id}: paid before created`);
      }
      for (const a of db.attempts()) {
        if (a.resolved_at && a.resolved_at < a.created_at) v.push(`${a.id}: resolved before created`);
      }
      return v;
    },
  },
];
