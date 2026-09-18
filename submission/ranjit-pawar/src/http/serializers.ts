import type { InvoiceRecord, SubscriptionEventRecord, SubscriptionRecord } from '../persistence/records';

/** API representations are explicit, so a persistence field rename cannot silently change the contract. */
export function toSubscriptionResource(record: SubscriptionRecord) {
  return {
    id: record.id,
    customer_id: record.customer_id,
    plan: record.plan,
    state: record.state,
    payment_method_id: record.payment_method_id,
    trial_ends_at: record.trial_ends_at,
    current_period_end: record.current_period_end,
    canceled_at: record.canceled_at,
    created_at: record.created_at,
    updated_at: record.updated_at
  };
}

export function toInvoiceResource(record: InvoiceRecord) {
  return {
    id: record.id,
    subscription_id: record.subscription_id,
    amount: record.amount_cents,
    currency: record.currency,
    status: record.status,
    attempt: record.attempt,
    provider_charge_id: record.provider_charge_id,
    failure_code: record.failure_code,
    paid_at: record.paid_at,
    refunded_at: record.refunded_at,
    created_at: record.created_at
  };
}

export function toEventResource(record: SubscriptionEventRecord) {
  return {
    seq: record.seq,
    kind: record.kind,
    transition: record.transition_id,
    trigger: record.trigger,
    from: record.from_state,
    to: record.to_state,
    note: record.note,
    source: record.source,
    invoice_id: record.invoice_id,
    event_id: record.event_id,
    occurred_at: record.occurred_at
  };
}
