/**
 * The API contract as the tests expect it — written on the test side, not imported
 * from the service, so a breaking change to the response shape fails the suite.
 */
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface SubscriptionView {
  id: string;
  customer_id: string;
  plan: string;
  payment_method_id: string;
  status: SubscriptionStatus;
  trial_ends_at: string;
  current_period_end: string | null;
  retry_count: number;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ErrorBody {
  error: { code: string; field?: string; message?: string };
}

export type WebhookOutcome =
  | 'applied'
  | 'ignored_stale'
  | 'ignored_invalid_transition'
  | 'ignored_unknown_reference'
  | 'ignored_amount_mismatch';

export interface WebhookAck {
  event_id: string;
  outcome: WebhookOutcome;
  duplicate: boolean;
}

export interface BillingRunResult {
  result: 'succeeded' | 'declined' | 'pending' | 'ignored_invalid_transition';
  subscription: SubscriptionView;
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}
