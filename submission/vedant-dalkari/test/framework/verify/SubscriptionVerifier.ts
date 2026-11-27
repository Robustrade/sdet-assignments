/**
 * Multi-layer verification facade matching API snapshots, SQLite ledger rows,
 * BillingGateway call logs, and AuditSpyNotifier emissions.
 * Author: Vedant Dalkari
 */

import { expect } from 'vitest';
import type { SubscriptionStatus } from '../../../src/domain/types.js';
import type { BillingApiClient } from '../clients/BillingApiClient.js';
import type { SubscriptionSnapshot } from '../clients/contracts.js';
import type { AuditSpyNotifier } from '../doubles/AuditSpyNotifier.js';
import type { RecordingBillingGateway } from '../doubles/RecordingBillingGateway.js';
import type { LedgerInspector, TableCounts } from './LedgerInspector.js';

export const CANONICAL_SUBSCRIPTION_KEYS = [
  'id',
  'customer_id',
  'plan',
  'status',
  'current_period_start',
  'current_period_end',
  'trial_ends_at',
  'failed_attempts',
  'canceled_at',
  'created_at',
  'updated_at',
] as const;

export class SubscriptionVerifier {
  public constructor(
    private readonly ledger: LedgerInspector,
    private readonly gateway: RecordingBillingGateway,
    private readonly notifier: AuditSpyNotifier,
    private readonly api: BillingApiClient,
  ) {}

  public assertExactSnapshotKeys(snapshot: SubscriptionSnapshot): void {
    const actualKeys = Object.keys(snapshot).sort();
    const expectedKeys = [...CANONICAL_SUBSCRIPTION_KEYS].sort();
    expect(actualKeys).toEqual(expectedKeys);
  }

  public async assertApiMatchesDb(subscriptionId: string): Promise<SubscriptionSnapshot> {
    const res = await this.api.getSubscription(subscriptionId);
    expect(res.status).toBe(200);
    this.assertExactSnapshotKeys(res.body);

    const dbRow = this.ledger.findSubscriptionById(subscriptionId);
    expect(dbRow).not.toBeNull();
    if (!dbRow) {
      throw new Error(`Missing SQLite subscription row for ${subscriptionId}`);
    }

    expect(res.body).toEqual({
      id: dbRow.id,
      customer_id: dbRow.customer_id,
      plan: dbRow.plan,
      status: dbRow.status,
      current_period_start: dbRow.current_period_start,
      current_period_end: dbRow.current_period_end,
      trial_ends_at: dbRow.trial_ends_at,
      failed_attempts: dbRow.failed_attempts,
      canceled_at: dbRow.canceled_at,
      created_at: dbRow.created_at,
      updated_at: dbRow.updated_at,
    });
    return res.body;
  }

  public assertTableCounts(expected: Partial<TableCounts>): void {
    const actual = this.ledger.countAllTables();
    for (const [table, count] of Object.entries(expected)) {
      const actualCount = actual[table as keyof TableCounts];
      expect(actualCount, `Expected table "${table}" row count`).toBe(count);
    }
  }

  public assertLastAuditEdge(
    subscriptionId: string,
    fromStatus: SubscriptionStatus | null,
    toStatus: SubscriptionStatus,
    trigger?: string,
  ): void {
    const logs = this.ledger.listAuditLogs(subscriptionId);
    expect(logs.length).toBeGreaterThan(0);
    const last = logs.at(-1);
    expect(last?.from_status).toBe(fromStatus);
    expect(last?.to_status).toBe(toStatus);
    if (trigger !== undefined) {
      expect(last?.trigger).toBe(trigger);
    }
  }

  public assertGatewayCalls(expectedCount: number): void {
    expect(this.gateway.callCount()).toBe(expectedCount);
  }

  public assertNotifierCount(expectedCount: number): void {
    expect(this.notifier.count()).toBe(expectedCount);
  }
}
