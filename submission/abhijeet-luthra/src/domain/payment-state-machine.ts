import { PaymentStatus } from './types';

/**
 * Payment-attempt status transitions (design §9 "Payment-attempt status").
 *
 * Final outcomes are never overwritten, which is what stops a stale
 * `payment.failed` from regressing an attempt that already succeeded.
 */
const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  pending: ['succeeded', 'failed', 'timed_out'],
  timed_out: ['succeeded', 'failed'], // reconciled later by a provider webhook
  succeeded: ['refunded'],
  failed: [],
  refunded: [],
};

export function canPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** "Unresolved" = we do not yet know the provider's final answer for this attempt. */
export function isUnresolved(status: PaymentStatus): boolean {
  return status === 'pending' || status === 'timed_out';
}
