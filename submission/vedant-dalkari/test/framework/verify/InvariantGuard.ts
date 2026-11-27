/**
 * Automated persistence and state-machine invariant guard (INV-1 through INV-8).
 * Author: Vedant Dalkari
 */

import { expect } from 'vitest';
import type { PlanCode } from '../../../src/domain/types.js';
import type { BillingApiClient } from '../clients/BillingApiClient.js';
import type { RecordingBillingGateway } from '../doubles/RecordingBillingGateway.js';
import type { LedgerInspector } from './LedgerInspector.js';

const PLAN_PRICING: Record<PlanCode, { amountCents: number; currency: string }> = {
  starter: { amountCents: 1900, currency: 'USD' },
  growth: { amountCents: 4900, currency: 'USD' },
};

const LEGAL_AUDIT_EDGES = new Set<string>([
  'null->trialing',
  'null->active',
  'null->past_due',
  'trialing->active',
  'trialing->past_due',
  'trialing->canceled',
  'active->past_due',
  'active->canceled',
  'past_due->active',
  'past_due->canceled',
]);

export type InvariantCode =
  | 'INV-1'
  | 'INV-2'
  | 'INV-3'
  | 'INV-4'
  | 'INV-5'
  | 'INV-6'
  | 'INV-7'
  | 'INV-8';

export class InvariantGuard {
  public constructor(
    private readonly ledger: LedgerInspector,
    private readonly gateway: RecordingBillingGateway,
    private readonly api?: BillingApiClient,
  ) {}

  public assertSchemaReady(): void {
    expect(
      this.ledger.hasAllBillingTables(),
      'InvariantGuard failed: required billing tables are missing from SQLite schema',
    ).toBe(true);
  }

  public assertInv1ActiveHasPaidPayment(): void {
    this.assertSchemaReady();
    const subs = this.ledger.listSubscriptions();
    for (const sub of subs) {
      if (sub.status === 'active') {
        const invoices = this.ledger.listInvoices(sub.id);
        const attempts = this.ledger.listPaymentAttempts(sub.id);
        const hasPaidInvoice = invoices.some((inv) => inv.status === 'paid');
        const hasSucceededAttempt = attempts.some((att) => att.status === 'succeeded');
        expect(
          hasPaidInvoice && hasSucceededAttempt,
          `INV-1 violated: active subscription ${sub.id} lacks paid invoice and succeeded attempt`,
        ).toBe(true);
      }
    }
  }

  public assertInv2CanceledImmutability(): void {
    this.assertSchemaReady();
    const subs = this.ledger.listSubscriptions();
    for (const sub of subs) {
      const logs = this.ledger.listAuditLogs(sub.id);
      let sawCanceled = false;
      for (const entry of logs) {
        expect(
          sawCanceled,
          `INV-2 violated: audit entry ${entry.id} recorded after canceled state for ${sub.id}`,
        ).toBe(false);
        expect(
          entry.from_status,
          `INV-2 violated: transition left canceled state for ${sub.id}`,
        ).not.toBe('canceled');
        if (entry.to_status === 'canceled') {
          sawCanceled = true;
        }
      }
    }
  }

  public assertInv3WebhookUniqueness(): void {
    this.assertSchemaReady();
    const duplicates = this.ledger.queryRows<{ event_id: string; cnt: number }>(
      'SELECT event_id, COUNT(*) AS cnt FROM webhook_events GROUP BY event_id HAVING COUNT(*) > 1',
    );
    expect(duplicates, 'INV-3 violated: duplicate event_id found in webhook_events').toEqual([]);
  }

  public assertInv4GatewayCallParity(): void {
    this.assertSchemaReady();
    const attempts = this.ledger.listPaymentAttempts();
    const gatewayAttempts = attempts.filter((att) => att.idempotency_key.startsWith('gw_'));
    expect(
      this.gateway.lifetimeCallCount(),
      'INV-4 violated: BillingGateway call count mismatches persisted gateway payment_attempts',
    ).toBe(gatewayAttempts.length);

    const persistedKeys = new Set(gatewayAttempts.map((att) => att.idempotency_key));
    for (const call of this.gateway.lifetimeCalls) {
      expect(
        persistedKeys.has(call.idempotencyKey),
        `INV-4 violated: gateway call idempotencyKey "${call.idempotencyKey}" not persisted`,
      ).toBe(true);
    }
  }

  public async assertInv5ApiMatchesDb(): Promise<void> {
    this.assertSchemaReady();
    if (!this.api) {
      return;
    }
    const subs = this.ledger.listSubscriptions();
    for (const sub of subs) {
      const res = await this.api.getSubscription(sub.id);
      expect(res.status, `INV-5 violated: GET /subscriptions/${sub.id} failed`).toBe(200);
      expect(res.body.status).toBe(sub.status);
      expect(res.body.plan).toBe(sub.plan);
      expect(res.body.failed_attempts).toBe(sub.failed_attempts);
      expect(res.body.canceled_at).toBe(sub.canceled_at);
      expect(res.body.trial_ends_at).toBe(sub.trial_ends_at);
      expect(res.body.current_period_start).toBe(sub.current_period_start);
      expect(res.body.current_period_end).toBe(sub.current_period_end);
    }
  }

  public assertInv6PlanPriceParity(): void {
    this.assertSchemaReady();
    const subsById = new Map(this.ledger.listSubscriptions().map((s) => [s.id, s]));
    const invoices = this.ledger.listInvoices();
    for (const inv of invoices) {
      const sub = subsById.get(inv.subscription_id);
      expect(sub, `INV-6 violated: orphan invoice ${inv.id}`).toBeDefined();
      if (!sub) continue;
      const expected = PLAN_PRICING[sub.plan];
      expect(inv.amount_cents, `INV-6 violated: invoice ${inv.id} amount mismatch`).toBe(
        expected.amountCents,
      );
      expect(inv.currency, `INV-6 violated: invoice ${inv.id} currency mismatch`).toBe(
        expected.currency,
      );
    }
  }

  public assertInv7PaidInvoiceNoRegression(): void {
    this.assertSchemaReady();
    const invoices = this.ledger.listInvoices();
    const attempts = this.ledger.listPaymentAttempts();
    for (const inv of invoices) {
      const invAttempts = attempts.filter((a) => a.invoice_id === inv.id);
      const hasSucceeded = invAttempts.some((a) => a.status === 'succeeded');
      if (hasSucceeded && inv.status !== 'refunded') {
        expect(
          inv.status,
          `INV-7 violated: invoice ${inv.id} has succeeded attempt but regressed to ${inv.status}`,
        ).toBe('paid');
      }
    }
  }

  public assertInv8AuditTrailValidity(): void {
    this.assertSchemaReady();
    const subs = this.ledger.listSubscriptions();
    for (const sub of subs) {
      const logs = this.ledger.listAuditLogs(sub.id);
      expect(logs.length, `INV-8 violated: subscription ${sub.id} has no audit log`).toBeGreaterThan(0);
      let expectedPrev: string | null = null;
      for (const entry of logs) {
        const edge = `${String(entry.from_status)}->${entry.to_status}`;
        expect(
          LEGAL_AUDIT_EDGES.has(edge),
          `INV-8 violated: illegal audit transition "${edge}" on ${sub.id}`,
        ).toBe(true);
        expect(
          entry.from_status,
          `INV-8 violated: discontinuous audit chain on ${sub.id}`,
        ).toBe(expectedPrev);
        expectedPrev = entry.to_status;
      }
      expect(
        expectedPrev,
        `INV-8 violated: final audit status mismatches subscription ${sub.id} status`,
      ).toBe(sub.status);
    }
  }

  public assertInvariant(code: InvariantCode): void {
    switch (code) {
      case 'INV-1':
        this.assertInv1ActiveHasPaidPayment();
        break;
      case 'INV-2':
        this.assertInv2CanceledImmutability();
        break;
      case 'INV-3':
        this.assertInv3WebhookUniqueness();
        break;
      case 'INV-4':
        this.assertInv4GatewayCallParity();
        break;
      case 'INV-6':
        this.assertInv6PlanPriceParity();
        break;
      case 'INV-7':
        this.assertInv7PaidInvoiceNoRegression();
        break;
      case 'INV-8':
        this.assertInv8AuditTrailValidity();
        break;
      case 'INV-5':
        throw new Error('Use assertInv5ApiMatchesDb() or assertAll() for async INV-5 check');
    }
  }

  public async assertAll(): Promise<void> {
    this.assertInv1ActiveHasPaidPayment();
    this.assertInv2CanceledImmutability();
    this.assertInv3WebhookUniqueness();
    this.assertInv4GatewayCallParity();
    await this.assertInv5ApiMatchesDb();
    this.assertInv6PlanPriceParity();
    this.assertInv7PaidInvoiceNoRegression();
    this.assertInv8AuditTrailValidity();
  }
}
