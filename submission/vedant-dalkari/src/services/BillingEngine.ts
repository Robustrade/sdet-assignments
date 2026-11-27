/**
 * Due billing & retry scheduler service driven by injected Clock and PlanPolicy.
 * Author: Vedant Dalkari
 */

import type { LifecycleEngine } from '../domain/LifecycleEngine.js';
import type { PlanPolicy, PlanPolicyRegistry } from '../domain/PlanPolicy.js';
import type { SubscriptionRecord } from '../domain/types.js';
import type { AuditLogRepo } from '../persistence/AuditLogRepo.js';
import type { InvoiceRepo } from '../persistence/InvoiceRepo.js';
import type { PaymentAttemptRepo } from '../persistence/PaymentAttemptRepo.js';
import type { SqliteDatabase } from '../persistence/SqliteDatabase.js';
import type { SubscriptionRepo } from '../persistence/SubscriptionRepo.js';
import type { BillingGateway, ChargeResult } from '../ports/BillingGateway.js';
import type { Clock } from '../ports/Clock.js';
import type { NotificationMessage, Notifier } from '../ports/Notifier.js';
import { invokeGatewaySafely, nextPrefixedId, toAttemptStatus } from './chargeHelpers.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface BillingEngineDeps {
  readonly db: SqliteDatabase;
  readonly subscriptionRepo: SubscriptionRepo;
  readonly invoiceRepo: InvoiceRepo;
  readonly paymentAttemptRepo: PaymentAttemptRepo;
  readonly auditLogRepo: AuditLogRepo;
  readonly lifecycleEngine: LifecycleEngine;
  readonly planRegistry: PlanPolicyRegistry;
  readonly billingGateway: BillingGateway;
  readonly clock: Clock;
  readonly notifier: Notifier;
}

export interface RunDueResult {
  readonly processedCount: number;
  readonly subscriptionIds: readonly string[];
}

export class BillingEngine {
  public constructor(private readonly deps: BillingEngineDeps) {}

  public async runDueBilling(): Promise<RunDueResult> {
    const nowIso = this.deps.clock.nowIso();
    const nowMs = Date.parse(nowIso);
    const candidates = this.deps.subscriptionRepo.findDueForBilling(nowIso);
    const processedIds: string[] = [];

    for (const candidate of candidates) {
      const policy = this.deps.planRegistry.resolve(candidate.plan);
      if (!this.isDue(candidate, policy, nowMs)) {
        continue;
      }

      const existingUnpaid =
        candidate.status === 'past_due'
          ? this.deps.invoiceRepo.findLatestUnpaidForSubscription(candidate.id)
          : null;
      const targetInvoiceId = existingUnpaid?.id ?? nextPrefixedId('inv');
      const idempotencyKey = `gw_${candidate.id}_${targetInvoiceId}_${nextPrefixedId('k')}`;

      const chargeResult = await invokeGatewaySafely(this.deps.billingGateway, {
        customerId: candidate.customer_id,
        amountCents: policy.config.amountCents,
        currency: policy.config.currency,
        paymentMethodId: candidate.payment_method_id,
        idempotencyKey,
      });

      const pendingNotification = this.commitDueAttempt({
        subscriptionId: candidate.id,
        policy,
        nowIso,
        targetInvoiceId,
        isExistingInvoice: existingUnpaid !== null,
        idempotencyKey,
        chargeResult,
      });

      if (pendingNotification) {
        await this.deps.notifier.notify(pendingNotification);
      }
      processedIds.push(candidate.id);
    }

    return {
      processedCount: processedIds.length,
      subscriptionIds: processedIds,
    };
  }

  private isDue(sub: SubscriptionRecord, policy: PlanPolicy, nowMs: number): boolean {
    if (sub.status === 'trialing') {
      return sub.trial_ends_at !== null && Date.parse(sub.trial_ends_at) <= nowMs;
    }
    if (sub.status === 'active') {
      return Date.parse(sub.current_period_end) <= nowMs;
    }
    if (sub.status === 'past_due') {
      const retryDueMs = Date.parse(sub.updated_at) + policy.config.retryIntervalDays * MS_PER_DAY;
      return retryDueMs <= nowMs;
    }
    return false;
  }

  private commitDueAttempt(params: {
    subscriptionId: string;
    policy: PlanPolicy;
    nowIso: string;
    targetInvoiceId: string;
    isExistingInvoice: boolean;
    idempotencyKey: string;
    chargeResult: ChargeResult;
  }): NotificationMessage | null {
    const {
      subscriptionId,
      policy,
      nowIso,
      targetInvoiceId,
      isExistingInvoice,
      idempotencyKey,
      chargeResult,
    } = params;

    return this.deps.db.inTransaction(() => {
      const fresh = this.deps.subscriptionRepo.findById(subscriptionId);
      if (!fresh || fresh.status === 'canceled') {
        return null;
      }

      const nextPeriod = policy.computeNextPeriod(nowIso);
      const isApproved = chargeResult.status === 'approved';
      const invoiceStatus = isApproved ? 'paid' : 'failed';

      const invoice = isExistingInvoice
        ? this.deps.invoiceRepo.updateStatus(targetInvoiceId, invoiceStatus, nowIso)
        : this.deps.invoiceRepo.create({
            id: targetInvoiceId,
            subscription_id: fresh.id,
            amount_cents: policy.config.amountCents,
            currency: policy.config.currency,
            status: invoiceStatus,
            period_start: nextPeriod.periodStart,
            period_end: nextPeriod.periodEnd,
            created_at: nowIso,
            updated_at: nowIso,
          });

      this.deps.paymentAttemptRepo.create({
        id: nextPrefixedId('att'),
        invoice_id: invoice.id,
        subscription_id: fresh.id,
        idempotency_key: idempotencyKey,
        amount_cents: policy.config.amountCents,
        currency: policy.config.currency,
        status: toAttemptStatus(chargeResult),
        provider_reference: chargeResult.status === 'approved' ? chargeResult.providerReference : null,
        failure_reason: chargeResult.status === 'approved' ? null : chargeResult.reason,
        created_at: nowIso,
      });

      if (fresh.status === 'trialing') {
        const trigger = isApproved ? 'trial_charge_succeeded' : 'trial_charge_failed';
        const transition = this.deps.lifecycleEngine.transition('trialing', trigger);
        this.deps.subscriptionRepo.commitTransition(fresh.id, transition, {
          failed_attempts: isApproved ? 0 : fresh.failed_attempts + 1,
          current_period_start: invoice.period_start,
          current_period_end: invoice.period_end,
          updated_at: nowIso,
        });
        this.deps.auditLogRepo.append({
          id: nextPrefixedId('aud'),
          subscription_id: fresh.id,
          from_status: 'trialing',
          to_status: transition.toStatus,
          trigger: transition.trigger,
          actor: 'scheduler',
          metadata_json: JSON.stringify({ invoice_id: invoice.id }),
          created_at: nowIso,
        });
        return {
          eventType: isApproved ? 'subscription.activated' : 'subscription.past_due',
          subscriptionId: fresh.id,
          customerId: fresh.customer_id,
          occurredAt: nowIso,
        };
      }

      if (fresh.status === 'active') {
        if (isApproved) {
          this.deps.subscriptionRepo.updateBillingPeriod(
            fresh.id,
            invoice.period_start,
            invoice.period_end,
            nowIso,
          );
          return null;
        }
        const transition = this.deps.lifecycleEngine.transition('active', 'renewal_charge_failed');
        this.deps.subscriptionRepo.commitTransition(fresh.id, transition, {
          failed_attempts: fresh.failed_attempts + 1,
          updated_at: nowIso,
        });
        this.deps.auditLogRepo.append({
          id: nextPrefixedId('aud'),
          subscription_id: fresh.id,
          from_status: 'active',
          to_status: transition.toStatus,
          trigger: transition.trigger,
          actor: 'scheduler',
          metadata_json: JSON.stringify({ invoice_id: invoice.id }),
          created_at: nowIso,
        });
        return {
          eventType: 'subscription.past_due',
          subscriptionId: fresh.id,
          customerId: fresh.customer_id,
          occurredAt: nowIso,
        };
      }

      // fresh.status === 'past_due'
      if (isApproved) {
        const transition = this.deps.lifecycleEngine.transition('past_due', 'retry_charge_succeeded');
        this.deps.subscriptionRepo.commitTransition(fresh.id, transition, {
          failed_attempts: 0,
          current_period_start: invoice.period_start,
          current_period_end: invoice.period_end,
          updated_at: nowIso,
        });
        this.deps.auditLogRepo.append({
          id: nextPrefixedId('aud'),
          subscription_id: fresh.id,
          from_status: 'past_due',
          to_status: transition.toStatus,
          trigger: transition.trigger,
          actor: 'scheduler',
          metadata_json: JSON.stringify({ invoice_id: invoice.id }),
          created_at: nowIso,
        });
        return {
          eventType: 'subscription.activated',
          subscriptionId: fresh.id,
          customerId: fresh.customer_id,
          occurredAt: nowIso,
        };
      }

      const nextFailed = fresh.failed_attempts + 1;
      if (policy.isRetryExhausted(nextFailed)) {
        const transition = this.deps.lifecycleEngine.transition('past_due', 'retries_exhausted');
        this.deps.subscriptionRepo.commitTransition(fresh.id, transition, {
          failed_attempts: nextFailed,
          canceled_at: nowIso,
          updated_at: nowIso,
        });
        this.deps.auditLogRepo.append({
          id: nextPrefixedId('aud'),
          subscription_id: fresh.id,
          from_status: 'past_due',
          to_status: transition.toStatus,
          trigger: transition.trigger,
          actor: 'scheduler',
          metadata_json: JSON.stringify({ invoice_id: invoice.id, failed_attempts: nextFailed }),
          created_at: nowIso,
        });
        return {
          eventType: 'subscription.canceled',
          subscriptionId: fresh.id,
          customerId: fresh.customer_id,
          occurredAt: nowIso,
        };
      }

      this.deps.subscriptionRepo.incrementFailedAttempts(fresh.id, nextFailed, nowIso);
      return null;
    });
  }
}
