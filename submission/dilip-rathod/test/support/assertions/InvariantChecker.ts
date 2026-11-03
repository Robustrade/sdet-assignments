import { SubscriptionContract } from '../api/contracts';
import type { SubscriptionApiClient } from '../api/SubscriptionApiClient';
import type { PersistenceInspector } from '../persistence/PersistenceInspector';
import type { MockPaymentProvider } from '../provider/MockPaymentProvider';
import type { Invariant } from './invariants';
import { INVARIANTS } from './invariants';

/** Fields the API exposes that map 1:1 onto a `subscriptions` column. */
const MIRRORED_FIELDS = [
  'status', 'plan', 'customer_id', 'payment_method_id', 'trial_ends_at', 'current_period_start',
  'current_period_end', 'next_billing_at', 'retry_count', 'canceled_at', 'cancel_reason', 'created_at', 'updated_at',
] as const;

/**
 * Checks every invariant against the full database, plus API ⇔ DB agreement for every subscription.
 * Wired into `afterEach`, so every scenario proves the invariants, not only the tests written for them.
 */
export class InvariantChecker {
  constructor(private readonly invariants: Invariant[] = INVARIANTS) {}

  async violations(db: PersistenceInspector, provider: MockPaymentProvider, api: SubscriptionApiClient): Promise<string[]> {
    const ctx = { db, providerRequests: provider.requests };
    const found = this.invariants.flatMap((inv) => inv.check(ctx).map((v) => `[${inv.name}] ${v}`));

    for (const row of db.subscriptions()) {
      const res = await api.getSubscription(row.id);
      const parsed = SubscriptionContract.safeParse(res.body);
      if (res.status !== 200 || !parsed.success) {
        found.push(`[API matches DB] GET ${row.id} returned ${res.status} / contract ${parsed.success ? 'ok' : 'broken'}`);
        continue;
      }
      for (const field of MIRRORED_FIELDS) {
        if (parsed.data[field] !== row[field]) {
          found.push(`[API matches DB] ${row.id}.${field}: api=${String(parsed.data[field])} db=${String(row[field])}`);
        }
      }
    }
    return found;
  }

  async assertHolds(db: PersistenceInspector, provider: MockPaymentProvider, api: SubscriptionApiClient): Promise<void> {
    const found = await this.violations(db, provider, api);
    if (found.length > 0) throw new Error(`Invariant violations:\n  - ${found.join('\n  - ')}`);
  }
}
