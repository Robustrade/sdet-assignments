/**
 * Typed HTTP client request and response contracts.
 * Author: Vedant Dalkari
 */

import type { PlanCode, SubscriptionSnapshot, WebhookOutcome } from '../../../src/domain/types.js';

export type { SubscriptionSnapshot };

export interface CreateSubscriptionPayload {
  readonly customer_id: string;
  readonly plan: PlanCode;
  readonly payment_method_id: string;
}

export interface ApiErrorBody {
  readonly error: string;
  readonly message: string;
}

export interface RunDueResponseBody {
  readonly processed_count: number;
  readonly subscription_ids: readonly string[];
}

export interface WebhookResponseBody {
  readonly status: 'processed' | 'duplicate_ignored' | 'ignored_stale_or_invalid';
  readonly event_id: string;
  readonly outcome?: WebhookOutcome;
  readonly error?: string;
}

export interface ApiResponse<T> {
  readonly status: number;
  readonly body: T;
  readonly rawBody: string;
}
