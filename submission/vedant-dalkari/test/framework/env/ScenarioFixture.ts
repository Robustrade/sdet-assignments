/**
 * High-level reusable scenario setup helpers built over typed clients and doubles.
 * Author: Vedant Dalkari
 */

import { expect } from 'vitest';
import type { InvoiceRecord } from '../../../src/domain/types.js';
import { SignupPayloadBuilder } from '../builders/SignupPayloadBuilder.js';
import type { BillingApiClient } from '../clients/BillingApiClient.js';
import type { SubscriptionSnapshot } from '../clients/contracts.js';
import type { ControlledClock } from '../doubles/ControlledClock.js';
import type { RecordingBillingGateway } from '../doubles/RecordingBillingGateway.js';
import type { LedgerInspector } from '../verify/LedgerInspector.js';

export interface SeededSubscriptionContext {
  readonly subscription: SubscriptionSnapshot;
  readonly invoice?: InvoiceRecord;
}

export class ScenarioFixture {
  public constructor(
    private readonly api: BillingApiClient,
    private readonly gateway: RecordingBillingGateway,
    private readonly clock: ControlledClock,
    private readonly ledger: LedgerInspector,
  ) {}

  public async createStarterActive(
    customerId: string = 'cust_001',
    paymentMethodId: string = 'pm_visa_4242',
  ): Promise<SeededSubscriptionContext> {
    this.gateway.approveNext('ch_seed_starter_ok');
    const payload = SignupPayloadBuilder.create()
      .forCustomer(customerId)
      .withStarterPlan()
      .withPaymentMethod(paymentMethodId)
      .build();
    const res = await this.api.createSubscription(payload);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('active');
    const invoices = this.ledger.listInvoices(res.body.id);
    return {
      subscription: res.body,
      invoice: invoices[0],
    };
  }

  public async createStarterPastDue(
    customerId: string = 'cust_001',
    paymentMethodId: string = 'pm_declined_0002',
    reason: string = 'card_declined',
  ): Promise<SeededSubscriptionContext> {
    this.gateway.declineNext(reason);
    const payload = SignupPayloadBuilder.create()
      .forCustomer(customerId)
      .withStarterPlan()
      .withPaymentMethod(paymentMethodId)
      .build();
    const res = await this.api.createSubscription(payload);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('past_due');
    const invoices = this.ledger.listInvoices(res.body.id);
    return {
      subscription: res.body,
      invoice: invoices[0],
    };
  }

  public async createGrowthTrialing(
    customerId: string = 'cust_001',
    paymentMethodId: string = 'pm_visa_4242',
  ): Promise<SubscriptionSnapshot> {
    const payload = SignupPayloadBuilder.create()
      .forCustomer(customerId)
      .withGrowthPlan()
      .withPaymentMethod(paymentMethodId)
      .build();
    const res = await this.api.createSubscription(payload);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('trialing');
    return res.body;
  }

  public seedPendingInvoice(options: {
    readonly invoiceId: string;
    readonly subscriptionId: string;
    readonly amountCents: number;
    readonly currency?: string;
    readonly periodStart?: string;
    readonly periodEnd?: string;
  }): InvoiceRecord {
    const now = this.clock.nowIso();
    const periodStart = options.periodStart ?? now;
    const periodEnd =
      options.periodEnd ??
      new Date(Date.parse(periodStart) + 30 * 24 * 60 * 60 * 1000).toISOString();
    const currency = options.currency ?? 'USD';

    this.ledger.executeRaw(
      `INSERT INTO invoices (id, subscription_id, amount_cents, currency, status, period_start, period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [
        options.invoiceId,
        options.subscriptionId,
        options.amountCents,
        currency,
        periodStart,
        periodEnd,
        now,
        now,
      ],
    );

    const created = this.ledger.findInvoiceById(options.invoiceId);
    if (!created) {
      throw new Error(`Failed to seed pending invoice ${options.invoiceId}`);
    }
    return created;
  }
}
