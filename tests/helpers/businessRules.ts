import { Database } from '../../src/database';
import { DAY_MS, PLANS } from '../../src/plans';
import { ALLOWED_MOVES, LifecycleEvent } from '../../src/stateMachine';

/**
 * Rules that must ALWAYS be true in the database, whatever happened.
 * Runs automatically after every test (see fixtures.ts). Returns broken rules (empty = all good).
 */
export function findBrokenRules(db: Database): string[] {
  const broken: string[] = [];

  for (const sub of db.allSubscriptions()) {
    const plan = PLANS[sub.plan];
    const invoices = db.invoicesOf(sub.id);

    // 1. Never active without a successful payment
    if (sub.status === 'active' && !invoices.some((i) => i.status === 'paid' || i.status === 'refunded')) {
      broken.push(`${sub.id} is active but has no successful payment`);
    }
    // 2. canceled_at is set only when canceled
    if ((sub.status === 'canceled') !== (sub.canceledAt !== null)) broken.push(`${sub.id} canceled_at does not match status`);
    // 3. Trial length follows the plan
    if (sub.trialEndsAt !== new Date(new Date(sub.createdAt).getTime() + plan.trialDays * DAY_MS).toISOString()) {
      broken.push(`${sub.id} trial end does not follow the ${plan.name} plan`);
    }
    // 4. Every invoice charges the plan price; attempts are 1, 2, 3...
    invoices.forEach((inv, i) => {
      if (inv.amount !== plan.priceCents || inv.currency !== plan.currency) broken.push(`${inv.id} has the wrong amount`);
      if (inv.attempt !== i + 1) broken.push(`${inv.id} attempt numbers have a gap`);
    });
    // 5. The audit history is a chain of ALLOWED moves that ends at the current status
    let previous: string | null = null;
    for (const row of db.auditOf(sub.id).filter((a) => a.to !== null)) {
      if (row.from !== previous) broken.push(`${sub.id} audit history has a gap at ${row.event}`);
      if (row.from !== null && ALLOWED_MOVES[row.from][row.event as LifecycleEvent] !== row.to) {
        broken.push(`${sub.id} audit shows an illegal move ${row.from} -> ${row.to}`);
      }
      previous = row.to;
    }
    if (previous !== sub.status) broken.push(`${sub.id} audit history does not end at ${sub.status}`);
  }
  return broken;
}
