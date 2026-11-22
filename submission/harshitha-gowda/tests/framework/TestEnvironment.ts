import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { BillingService } from '../../src/billing-service.ts';
import { createDatabase } from '../../src/db.ts';
import { createApp } from '../../src/server.ts';
import type { SubscriptionStatus } from '../../src/state-machine.ts';
import { ApiClient } from './ApiClient.ts';
import { MockPaymentProvider } from './MockPaymentProvider.ts';
import { WebhookSimulator } from './WebhookSimulator.ts';
import { PersistenceInspector } from './repositories.ts';
import { SubscriptionRequestBuilder, WebhookEventBuilder } from './builders.ts';

export const WEBHOOK_SECRET = 'whsec_test_secret';
export const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');

/** Owns one isolated world per test: fresh in-memory DB, fresh mock provider, real HTTP server on a random port. */
export class TestEnvironment {
  readonly touched = new Set<string>();

  private constructor(
    readonly server: Server,
    readonly api: ApiClient,
    readonly provider: MockPaymentProvider,
    readonly webhooks: WebhookSimulator,
    readonly db: PersistenceInspector,
  ) {}

  static async start(): Promise<TestEnvironment> {
    const rawDb = createDatabase(['cust_001', 'cust_002']);
    const provider = new MockPaymentProvider();
    const service = new BillingService({ db: rawDb, provider, clock: () => FIXED_NOW });
    const server = createApp(service, WEBHOOK_SECRET);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    let env!: TestEnvironment;
    const api = new ApiClient(`http://127.0.0.1:${port}`, (id) => env.touched.add(id));
    env = new TestEnvironment(server, api, provider, new WebhookSimulator(WEBHOOK_SECRET), new PersistenceInspector(rawDb));
    return env;
  }

  async stop() {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Sends a correctly signed webhook built from a builder. */
  async sendWebhook(builder: WebhookEventBuilder) {
    const req = this.webhooks.signed(builder.build());
    return this.api.postWebhook(req.body, req.headers);
  }

  /**
   * Factory: drives the REAL API (and mock) until a subscription reaches `status`,
   * then clears the provider call log so the test asserts only on its own actions.
   */
  async subscriptionIn(status: SubscriptionStatus, plan: 'pro' | 'basic' = 'pro'): Promise<string> {
    const created = await this.api.createSubscription(SubscriptionRequestBuilder.aSubscription().onPlan(plan).build());
    assert.equal(created.status, 201);
    const id: string = created.body.id;

    switch (status) {
      case 'trialing':
        assert.equal(plan, 'pro');
        break;
      case 'active':
        if (plan === 'pro') { this.provider.nextSucceeds(); await this.api.advanceTrial(id); }
        break;
      case 'past_due':
        this.provider.nextDeclines(); await this.api.advanceTrial(id);
        break;
      case 'canceled':
        await this.api.cancel(id);
        break;
    }
    this.provider.clearCalls();
    return id;
  }

  /** The id of the single invoice currently on record for a subscription. */
  onlyInvoiceOf(subId: string) {
    const invoices = this.db.invoices.forSubscription(subId);
    assert.equal(invoices.length, 1, `expected exactly one invoice for ${subId}`);
    return invoices[0];
  }

  /** Cross-cutting invariants, checked after EVERY test for every subscription the test created. */
  verifyInvariants() {
    for (const subId of this.touched) {
      const sub = this.db.subscriptions.find(subId);
      assert.ok(sub, `${subId} must exist`);
      const invoices = this.db.invoices.forSubscription(subId);
      const audit = this.db.audit.forSubscription(subId);

      // 1. active/trial-converted subscriptions always have a successful payment on record
      if (sub.status === 'active') {
        assert.ok(
          invoices.some((i) => i.status === 'paid' || i.status === 'refunded'),
          `${subId} is active but has no successful payment record`,
        );
      }

      // 2. audit log is a coherent chain that ends at the current status
      assert.ok(audit.length >= 1, `${subId} has no audit trail`);
      assert.equal(audit[0].from_status, null, 'first audit row must be the creation');
      audit.forEach((row, i) => { if (i > 0) assert.equal(row.from_status, audit[i - 1].to_status, `audit chain broken at #${i}`); });
      assert.equal(audit[audit.length - 1].to_status, sub.status, 'last audit row must equal persisted status');

      // 3. canceled is terminal: nothing is recorded after it
      const cancelIdx = audit.findIndex((r) => r.to_status === 'canceled');
      if (cancelIdx !== -1) assert.equal(cancelIdx, audit.length - 1, 'transition recorded after canceled');

      // 4. an invoice id is never recorded twice for the same subscription
      assert.equal(new Set(invoices.map((i) => i.id)).size, invoices.length, 'duplicate invoice rows');

    }

    // 6. every webhook event_id has at most ONE non-duplicate row (idempotency)
    const processed = new Map<string, number>();
    for (const e of this.db.webhookEvents.all()) {
      if (e.outcome !== 'duplicate') processed.set(e.event_id, (processed.get(e.event_id) ?? 0) + 1);
    }
    for (const [eventId, n] of processed) assert.equal(n, 1, `event ${eventId} processed ${n} times`);
  }

  /** API response and DB row must agree. */
  async expectApiMatchesDb(subId: string) {
    const api = await this.api.getSubscription(subId);
    const row = this.db.subscriptions.find(subId);
    assert.equal(api.status, 200);
    assert.ok(row);
    assert.deepEqual(
      { status: api.body.status, plan: api.body.plan, amount: api.body.amount, currency: api.body.currency, customer_id: api.body.customer_id, trial_ends_at: api.body.trial_ends_at },
      { status: row.status, plan: row.plan, amount: row.amount, currency: row.currency, customer_id: row.customer_id, trial_ends_at: row.trial_ends_at },
    );
  }
}
