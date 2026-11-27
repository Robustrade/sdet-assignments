/**
 * Shared service helpers for ID generation, snapshot mapping, and safe gateway invocation.
 * Author: Vedant Dalkari
 */

import { randomUUID } from 'node:crypto';
import { ValidationError } from '../domain/errors.js';
import type {
  PaymentAttemptStatus,
  SubscriptionRecord,
  SubscriptionSnapshot,
} from '../domain/types.js';
import type { BillingGateway, ChargeRequest, ChargeResult } from '../ports/BillingGateway.js';

export function toAttemptStatus(result: ChargeResult): PaymentAttemptStatus {
  return result.status === 'approved' ? 'succeeded' : result.status;
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`Field "${field}" must be a non-empty string`);
  }
  return value.trim();
}

export function nextPrefixedId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function toSubscriptionSnapshot(record: SubscriptionRecord): SubscriptionSnapshot {
  return {
    id: record.id,
    customer_id: record.customer_id,
    plan: record.plan,
    status: record.status,
    current_period_start: record.current_period_start,
    current_period_end: record.current_period_end,
    trial_ends_at: record.trial_ends_at,
    failed_attempts: record.failed_attempts,
    canceled_at: record.canceled_at,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

export async function invokeGatewaySafely(
  gateway: BillingGateway,
  request: ChargeRequest,
): Promise<ChargeResult> {
  try {
    return await gateway.charge(request);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'gateway_timeout';
    return { status: 'timeout', reason };
  }
}
