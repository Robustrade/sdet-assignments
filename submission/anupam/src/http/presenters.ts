import type { Invoice, Subscription } from '../domain/types';

export interface SubscriptionDto {
  id: string;
  customer_id: string;
  plan: string;
  payment_method_id: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  latest_invoice: { id: string; amount: number; currency: string; status: string } | null;
}

export const toSubscriptionDto = (s: Subscription, latest?: Invoice): SubscriptionDto => ({
  id: s.id,
  customer_id: s.customerId,
  plan: s.plan,
  payment_method_id: s.paymentMethodId,
  status: s.status,
  trial_ends_at: s.trialEndsAt,
  current_period_end: s.currentPeriodEnd,
  canceled_at: s.canceledAt,
  created_at: s.createdAt,
  updated_at: s.updatedAt,
  latest_invoice: latest
    ? { id: latest.id, amount: latest.amount, currency: latest.currency, status: latest.status }
    : null,
});
